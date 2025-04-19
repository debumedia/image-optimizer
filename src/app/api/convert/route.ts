import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'image-optimizer');
const ALLOWED_FORMATS = ['webp', 'jpeg', 'png'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

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

    // Generate a unique session ID
    const sessionId = uuidv4();
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
        const ext = file.name.split('.').pop() || 'img';
        const baseName = path.basename(file.name, path.extname(file.name));
        // Sanitize baseName
        const safeBase = baseName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const originalPath = path.join(originalDir, `${safeBase}.${ext}`);
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(originalPath, buffer);
        return { originalPath, safeBase, ext };
      })
    );

    // Convert and save output files
    const convertedFiles = await Promise.all(
      savedFiles.map(async ({ originalPath, safeBase }) => {
        const outputPath = path.join(outputDir, `${safeBase}.${format}`);
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
        return { name: safeBase, format, file: `${safeBase}.${format}` };
      })
    );

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