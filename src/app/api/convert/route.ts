import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'image-optimizer');
const ALLOWED_FORMATS = ['webp', 'jpeg', 'png'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const DB_PATH = path.join(process.cwd(), 'tmp', 'image-optimizer.sqlite');
const db = new Database(DB_PATH);

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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, file_path),
    FOREIGN KEY(session_id) REFERENCES sessions(session_id)
  );
`);

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
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
        // Use the full, unique file name from the frontend
        const origExt = file.name.split('.').pop() || 'img';
        const baseNameWithSuffix = file.name.replace(/\.[^/.]+$/, '');
        // Sanitize for path safety but keep suffixes and parens
        const safeBase = baseNameWithSuffix.replace(/[^a-zA-Z0-9._()\-]/g, '');
        const safeOrigFileName = `${safeBase}.${origExt}`;
        const originalPath = path.join(originalDir, safeOrigFileName);
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(originalPath, buffer);
        return { originalPath, safeBase, origExt, origFileName: file.name };
      })
    );

    // Convert and save output files
    const convertedFiles = await Promise.all(
      savedFiles.map(async ({ originalPath, safeBase, origExt, origFileName }) => {
        // Output file: use the same base name as the original, but with the new format extension
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
        // Generate and save thumbnail (always as webp)
        const thumbBuffer = await sharp(inputBuffer).resize(128, 128, { fit: 'cover' }).webp().toBuffer();
        await fs.writeFile(thumbnailPath, thumbBuffer);
        return { name: outputFileName, format, file: outputFileName, thumbnail: `${safeBase}_thumb.webp` };
      })
    );

    // Insert or replace session and file records
    db.prepare('INSERT OR IGNORE INTO sessions (session_id) VALUES (?)').run(sessionId);
    convertedFiles.forEach(({ name, format, file, thumbnail }) => {
      db.prepare('INSERT OR REPLACE INTO files (session_id, file_name, file_path, format, thumbnail_path) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, name, file, format, thumbnail);
    });

    // Return session ID and file info for download
    return NextResponse.json({ sessionId, files: convertedFiles });
  } catch (error) {
    console.error('Error processing images:', error);
    return NextResponse.json(
      { error: 'Failed to process images' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }
  const files = db.prepare('SELECT file_name, file_path, format, thumbnail_path, created_at FROM files WHERE session_id = ?').all(sessionId);
  const sessionDir = path.join(TMP_ROOT, sessionId, 'output');
  const filteredFiles = [];
  for (const file of files as { file_name: string; file_path: string; format: string; thumbnail_path: string }[]) {
    const filePath = path.join(sessionDir, file.file_path);
    const thumbPath = path.join(sessionDir, file.thumbnail_path);
    try {
      await fs.access(filePath);
      await fs.access(thumbPath);
      filteredFiles.push({
        name: file.file_name,
        format: file.format,
        file: file.file_path,
        thumbnail: file.thumbnail_path
      });
    } catch {
      db.prepare('DELETE FROM files WHERE session_id = ? AND file_name = ?').run(sessionId, file.file_name);
    }
  }
  return NextResponse.json({ files: filteredFiles });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }
  // Get all file paths for this session
  const files = db.prepare('SELECT file_path, thumbnail_path FROM files WHERE session_id = ?').all(sessionId);
  const sessionDir = path.join(TMP_ROOT, sessionId, 'output');
  // Delete files from disk
  for (const file of files as { file_name: string; file_path: string; format: string; thumbnail_path: string }[]) {
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
} 