import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

const TMP_ROOT = path.join(process.cwd(), 'tmp', 'image-optimizer');

export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get('session');
  const file = req.nextUrl.searchParams.get('file');

  if (!session || !file) {
    return new NextResponse('Missing parameters', { status: 400 });
  }

  const safeSession = session.replace(/[^a-zA-Z0-9\-_]/g, '');
  const safeFile = path.basename(file).replace(/[^a-zA-Z0-9._\-]/g, '');
  const thumbPath = path.join(TMP_ROOT, safeSession, 'output', safeFile);

  if (!thumbPath.startsWith(path.join(TMP_ROOT, safeSession, 'output'))) {
    return new NextResponse('Invalid file path', { status: 400 });
  }

  try {
    const fileBuffer = await fs.readFile(thumbPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Content-Disposition': `inline; filename="${safeFile}"`,
      },
    });
  } catch {
    return new NextResponse('File not found', { status: 404 });
  }
} 