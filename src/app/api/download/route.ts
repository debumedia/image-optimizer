import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import mime from 'mime';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'image-optimizer');

export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get('session');
  const file = req.nextUrl.searchParams.get('file');

  // Basic validation
  if (!session || !file) {
    return new NextResponse('Missing parameters', { status: 400 });
  }

  // Sanitize session and file (allow only safe chars)
  const safeSession = session.replace(/[^a-zA-Z0-9\-_]/g, '');
  const safeFile = path.basename(file).replace(/[^a-zA-Z0-9._\-]/g, '');

  // Only allow access to output directory
  const filePath = path.join(TMP_ROOT, safeSession, 'output', safeFile);

  // Prevent path traversal
  if (!filePath.startsWith(path.join(TMP_ROOT, safeSession, 'output'))) {
    return new NextResponse('Invalid file path', { status: 400 });
  }

  try {
    const fileBuffer = await fs.readFile(filePath);
    const contentType = mime.getType(filePath) || 'application/octet-stream';
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeFile}"`,
      },
    });
  } catch (err) {
    return new NextResponse('File not found', { status: 404 });
  }
} 