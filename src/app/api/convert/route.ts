import { NextResponse } from 'next/server';
import sharp from 'sharp';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('images') as File[];
    const format = formData.get('format') as string;

    const convertedImages = await Promise.all(
      files.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        const fileName = file.name.split('.')[0];
        
        let convertedBuffer;
        switch (format) {
          case 'webp':
            convertedBuffer = await sharp(buffer).webp().toBuffer();
            break;
          case 'jpeg':
            convertedBuffer = await sharp(buffer).jpeg().toBuffer();
            break;
          case 'png':
            convertedBuffer = await sharp(buffer).png().toBuffer();
            break;
          default:
            throw new Error('Unsupported format');
        }

        const base64 = convertedBuffer.toString('base64');
        const dataUrl = `data:image/${format};base64,${base64}`;

        return {
          name: fileName,
          url: dataUrl,
          format,
        };
      })
    );

    return NextResponse.json(convertedImages);
  } catch (error) {
    console.error('Error processing images:', error);
    return NextResponse.json(
      { error: 'Failed to process images' },
      { status: 500 }
    );
  }
} 