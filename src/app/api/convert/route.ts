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

    // Handle reconvert requests
    const reconvertFrom = formData.getAll('reconvertFrom[]') as string[];
    const reconvertName = formData.getAll('reconvertName[]') as string[];
    const reconvertPairs = reconvertFrom.map((from, i) => ({ from, to: reconvertName[i] }));

    // Save original files to disk (from uploads)
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

    // Convert and save output files (from uploads)
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

    // Handle reconvert conversions
    const reconvertConverted = await Promise.all(
      reconvertPairs.map(async ({ from, to }) => {
        try {
          console.log('Reconverting:', { from, to });

          // Look up the original file record in the DB
          const origRecord = db.prepare('SELECT file_path, original_file_name, original_size FROM files WHERE session_id = ? AND file_name = ?').get(sessionId, from) as { file_path: string; original_file_name: string; original_size: number } | undefined;
          if (!origRecord) {
            console.error('Original file record not found for reconvert:', from);
            throw new Error(`Original file record not found for reconvert: ${from}`);
          }

          console.log('Found original record:', origRecord);

          // Check both output and original directories for the source file
          // First try the output directory (for reconverts of already converted files)
          const outputSourcePath = path.join(outputDir, origRecord.file_path);
          // Also try the original directory (for first-time conversions)
          const originalSourcePath = path.join(originalDir, origRecord.file_path);
          
          // Determine which file exists and use that as the source
          let inputBuffer: Buffer;
          try {
            try {
              // First try the output directory
              console.log('Trying output source path:', outputSourcePath);
              inputBuffer = await fs.readFile(outputSourcePath);
              console.log('Found source file in output directory');
            } catch (err) {
              // If that fails, try the original directory
              console.log('Trying original source path:', originalSourcePath);
              inputBuffer = await fs.readFile(originalSourcePath);
              console.log('Found source file in original directory');
            }
          } catch (err) {
            console.error('Error reading source file for reconvert:', err);
            throw new Error(`Could not find source file for reconvert in either output or original directory: ${origRecord.file_path}`);
          }

          // Use a completely different name for the output to avoid overwriting
          const now = new Date();
          const pad = (n: number) => n.toString().padStart(2, '0');
          const timestamp = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
          
          // Base normalized name without timestamp
          const baseName = normalizeFileName(to.replace(/\.[^/.]+$/, '').replace(/_\d{14}$/, ''));
          
          // Generate unique filename with timestamp
          const reconvertBase = `${baseName}_${timestamp}`;
          
          console.log('Timestamp generated:', timestamp);
          console.log('Normalized reconvert name with timestamp:', reconvertBase);
          
          const outputFileName = `${reconvertBase}.${format}`;
          const outputPath = path.join(outputDir, outputFileName);
          const thumbnailPath = path.join(outputDir, `${reconvertBase}_thumb.webp`);
          
          console.log('Output paths:', { outputFileName, outputPath, thumbnailPath });

          // Read the original file and create a new converted file
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

          // Write the new converted file
          await fs.writeFile(outputPath, convertedBuffer);
          console.log('Wrote converted file');

          const { size: convertedSize } = await fs.stat(outputPath);
          console.log('Converted size:', convertedSize);

          // Generate and save thumbnail
          const thumbBuffer = await sharp(inputBuffer).resize(128, 128, { fit: 'cover' }).webp().toBuffer();
          await fs.writeFile(thumbnailPath, thumbBuffer);
          console.log('Wrote thumbnail');

          return {
            name: to, // for display
            normalizedName: outputFileName, // for API/DB
            format,
            file: outputFileName, // This is the filename used for downloads
            thumbnail: `${reconvertBase}_thumb.webp`,
            originalSize: origRecord.original_size,
            convertedSize
          };
        } catch (error) {
          console.error('Error in reconvert:', error);
          throw error;
        }
      })
    );

    // Insert or replace session and file records
    db.prepare('INSERT OR IGNORE INTO sessions (session_id) VALUES (?)').run(sessionId);
    convertedFiles.forEach(({ name, normalizedName, format, file, thumbnail, originalSize, convertedSize }, idx) => {
      db.prepare('INSERT OR REPLACE INTO files (session_id, file_name, file_path, format, thumbnail_path, original_file_name, original_size, converted_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(sessionId, name, normalizedName, format, thumbnail, savedFiles[idx].origFileName, originalSize, convertedSize);
    });
    // Insert reconvert conversions
    reconvertConverted.forEach(({ name, normalizedName, format, file, thumbnail, originalSize, convertedSize }) => {
      db.prepare('INSERT OR REPLACE INTO files (session_id, file_name, file_path, format, thumbnail_path, original_file_name, original_size, converted_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(sessionId, name, normalizedName, format, thumbnail, name, originalSize, convertedSize);
    });

    // Return session ID and file info for download
    return NextResponse.json({ sessionId, files: [...convertedFiles, ...reconvertConverted] });
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
      const originalDir = path.join(TMP_ROOT, sessionId, 'original');
      
      console.log('Deleting file:', { sessionId, file });
      
      // First, try to find the file by name (display name)
      const fileRecord = db.prepare('SELECT file_name, file_path, thumbnail_path, original_file_name FROM files WHERE session_id = ? AND file_name = ?').get(sessionId, file) as { 
        file_name: string; 
        file_path: string; 
        thumbnail_path: string; 
        original_file_name: string 
      } | undefined;
      
      if (fileRecord) {
        console.log('Found file record by name:', fileRecord);
        const filePath = path.join(sessionDir, fileRecord.file_path);
        const thumbPath = path.join(sessionDir, fileRecord.thumbnail_path);
        const origPath = path.join(originalDir, fileRecord.original_file_name);
        
        try { 
          await fs.unlink(filePath); 
          console.log('Deleted file:', filePath);
        } catch (e) { 
          console.error('Error deleting file:', filePath, e); 
        }
        
        try { 
          await fs.unlink(thumbPath); 
          console.log('Deleted thumbnail:', thumbPath);
        } catch (e) { 
          console.error('Error deleting thumbnail:', thumbPath, e); 
        }
        
        // Only delete original if no other files reference it
        const originalFileCount = db.prepare('SELECT COUNT(*) as count FROM files WHERE session_id = ? AND original_file_name = ?').get(sessionId, fileRecord.original_file_name) as { count: number };
        if (originalFileCount.count <= 1) {
          try { 
            await fs.unlink(origPath); 
            console.log('Deleted original:', origPath);
          } catch (e) { 
            console.error('Error deleting original:', origPath, e); 
          }
        } else {
          console.log('Not deleting original file as it is referenced by other conversions:', origPath);
        }
        
        // Delete from DB using file_name (display name)
        db.prepare('DELETE FROM files WHERE session_id = ? AND file_name = ?').run(sessionId, file);
        console.log('Deleted DB record for:', file);
      } else {
        console.log('File record not found for:', file);
      }
      
      // If no more files, clean up session and directories
      const remaining = db.prepare('SELECT COUNT(*) as count FROM files WHERE session_id = ?').get(sessionId) as { count: number };
      if (remaining.count === 0) {
        console.log('No more files in session, cleaning up directories');
        try { await fs.rm(sessionDir, { recursive: true, force: true }); } catch (e) { console.error('Error removing output dir:', e); }
        try { await fs.rm(originalDir, { recursive: true, force: true }); } catch (e) { console.error('Error removing original dir:', e); }
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