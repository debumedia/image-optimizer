import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import fsSync from 'fs';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'image-optimizer');
const ALLOWED_FORMATS = ['webp', 'jpeg', 'png'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const DB_PATH = path.join(process.cwd(), 'tmp', 'image-optimizer.sqlite');
const db = new Database(DB_PATH);

// Ensure tmp and tmp/image-optimizer directories exist before DB init
fsSync.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });
fsSync.mkdirSync(TMP_ROOT, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    format TEXT,
    thumbnail_path TEXT,
    original_file_name TEXT,
    original_size INTEGER,
    converted_size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, file_path),
    FOREIGN KEY(session_id) REFERENCES sessions(session_id)
  );
`);

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function normalizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('images') as File[];
    const format = formData.get('format') as string;

    if (!ALLOWED_FORMATS.includes(format)) {
      return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
    }

    // Use sessionId from formData if provided, otherwise generate a new one
    let sessionId = formData.get('sessionId') as string | null;
    if (!sessionId) {
      sessionId = uuidv4();
    }
    const sessionDir = path.join(TMP_ROOT, sessionId);
    const originalDir = path.join(sessionDir, 'original');
    const outputDir = path.join(sessionDir, 'output');
    await ensureDir(originalDir);
    await ensureDir(outputDir);

    // Save original files to disk
    const savedFiles = await Promise.all(
      files.map(async (file) => {
        if (!ALLOWED_MIME.includes(file.type)) {
          throw new Error('Unsupported file type');
        }
        // Use the full, unique file name from the frontend, normalized
        const origExt = file.name.split('.').pop() || 'img';
        const baseNameWithSuffix = file.name.replace(/\.[^/.]+$/, '');
        const safeBase = normalizeFileName(baseNameWithSuffix);
        const safeOrigFileName = `${safeBase}.${origExt}`;
        const originalPath = path.join(originalDir, safeOrigFileName);
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(originalPath, buffer);
        const { size: originalSize } = await fs.stat(originalPath);
        return { originalPath, safeBase, origExt, origFileName: file.name, originalSize, normalizedFileName: safeOrigFileName };
      })
    );

    // Convert and save output files
    const convertedFiles = await Promise.all(
      savedFiles.map(async ({ originalPath, safeBase, origExt, origFileName, originalSize, normalizedFileName }) => {
        // Output file: use the normalized base name with the new format extension
        const outputFileName = `${safeBase}.${format}`;
        const outputPath = path.join(outputDir, outputFileName);
        const thumbnailPath = path.join(outputDir, `${safeBase}_thumb.webp`);
        const inputBuffer = await fs.readFile(originalPath);
        let convertedBuffer: Buffer;
        switch (format) {
          case 'webp':
            convertedBuffer = await sharp(inputBuffer).webp().toBuffer();
            break;
          case 'jpeg':
            convertedBuffer = await sharp(inputBuffer).jpeg().toBuffer();
            break;
          case 'png':
            convertedBuffer = await sharp(inputBuffer).png().toBuffer();
            break;
          default:
            throw new Error('Unsupported format');
        }
        await fs.writeFile(outputPath, convertedBuffer);
        const { size: convertedSize } = await fs.stat(outputPath);
        // Generate and save thumbnail (always as webp)
        const thumbBuffer = await sharp(inputBuffer).resize(128, 128, { fit: 'cover' }).webp().toBuffer();
        await fs.writeFile(thumbnailPath, thumbBuffer);
        return {
          name: origFileName, // for display
          normalizedName: outputFileName, // for API/DB
          format,
          file: outputFileName,
          thumbnail: `${safeBase}_thumb.webp`,
          originalSize,
          convertedSize
        };
      })
    );

    // Insert or replace session and file records
    db.prepare('INSERT OR IGNORE INTO sessions (session_id) VALUES (?)').run(sessionId);
    convertedFiles.forEach(({ name, normalizedName, format, file, thumbnail, originalSize, convertedSize }, idx) => {
      db.prepare('INSERT OR REPLACE INTO files (session_id, file_name, file_path, format, thumbnail_path, original_file_name, original_size, converted_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(sessionId, name, normalizedName, format, thumbnail, savedFiles[idx].origFileName, originalSize, convertedSize);
    });

    // Return session ID and file info for download
    return NextResponse.json({ sessionId, files: convertedFiles });
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error processing images:', error.message, error.stack);
    } else {
      console.error('Error processing images:', error);
    }
    return NextResponse.json(
      { error: 'Failed to process images' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }
    const files = db.prepare('SELECT file_name, file_path, format, thumbnail_path, original_size, converted_size, created_at FROM files WHERE session_id = ?').all(sessionId);
    const sessionDir = path.join(TMP_ROOT, sessionId, 'output');
    const filteredFiles = [];
    for (const file of files as { file_name: string; file_path: string; format: string; thumbnail_path: string; original_size: number; converted_size: number }[]) {
      const filePath = path.join(sessionDir, file.file_path);
      const thumbPath = path.join(sessionDir, file.thumbnail_path);
      try {
        await fs.access(filePath);
        await fs.access(thumbPath);
        filteredFiles.push({
          name: file.file_name, // display original name
          format: file.format,
          file: file.file_path, // use normalized name for API
          thumbnail: file.thumbnail_path,
          originalSize: file.original_size,
          convertedSize: file.converted_size
        });
      } catch {
        db.prepare('DELETE FROM files WHERE session_id = ? AND file_name = ?').run(sessionId, file.file_name);
      }
    }
    return NextResponse.json({ files: filteredFiles });
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error in GET /api/convert:', error.message, error.stack);
    } else {
      console.error('Error in GET /api/convert:', String(error));
    }
    return NextResponse.json(
      { error: 'Failed to fetch files' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    const file = searchParams.get('file');
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }
    if (file) {
      // Delete a single file
      const sessionDir = path.join(TMP_ROOT, sessionId, 'output');
      const safeFile = normalizeFileName(file);
      const fileRecord = db.prepare('SELECT file_path, thumbnail_path, original_file_name FROM files WHERE session_id = ? AND file_path = ?').get(sessionId, safeFile) as { file_path: string; thumbnail_path: string; original_file_name: string } | undefined;
      if (fileRecord) {
        const filePath = path.join(sessionDir, fileRecord.file_path);
        const thumbPath = path.join(sessionDir, fileRecord.thumbnail_path);
        const originalDir = path.join(TMP_ROOT, sessionId, 'original');
        const origPath = path.join(originalDir, fileRecord.original_file_name);
        try { await fs.unlink(filePath); } catch {}
        try { await fs.unlink(thumbPath); } catch {}
        try { await fs.unlink(origPath); } catch {}
        db.prepare('DELETE FROM files WHERE session_id = ? AND file_path = ?').run(sessionId, safeFile);
      }
      // If no more files, clean up session and directories
      const remaining = db.prepare('SELECT COUNT(*) as count FROM files WHERE session_id = ?').get(sessionId).count;
      if (remaining === 0) {
        const originalDir = path.join(TMP_ROOT, sessionId, 'original');
        try { await fs.rm(sessionDir, { recursive: true, force: true }); } catch {}
        try { await fs.rm(originalDir, { recursive: true, force: true }); } catch {}
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
      }
      return NextResponse.json({ success: true });
    }
    // Get all file paths for this session
    const files = db.prepare('SELECT file_path, thumbnail_path FROM files WHERE session_id = ?').all(sessionId) as { file_path: string; thumbnail_path: string }[];
    const sessionDir = path.join(TMP_ROOT, sessionId, 'output');
    // Delete files from disk
    for (const file of files) {
      const filePath = path.join(sessionDir, file.file_path);
      const thumbPath = path.join(sessionDir, file.thumbnail_path);
      try { await fs.unlink(filePath); } catch {}
      try { await fs.unlink(thumbPath); } catch {}
    }
    // Remove session output and original directories if empty
    const originalDir = path.join(TMP_ROOT, sessionId, 'original');
    try { await fs.rm(sessionDir, { recursive: true, force: true }); } catch {}
    try { await fs.rm(originalDir, { recursive: true, force: true }); } catch {}
    // Delete from DB
    db.prepare('DELETE FROM files WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error in DELETE /api/convert:', error.message, error.stack);
    } else {
      console.error('Error in DELETE /api/convert:', String(error));
    }
    return NextResponse.json(
      { error: 'Failed to delete files' },
      { status: 500 }
    );
  }
} 