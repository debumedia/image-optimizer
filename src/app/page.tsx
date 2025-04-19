'use client';

import Image from "next/image";
import ImageUploader from '@/components/ImageUploader';

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Image Optimizer</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Convert your images to WebP, JPEG, or PNG format with a single click. Download individual images or get them all in a ZIP file.
          </p>
        </div>
        <ImageUploader />
      </div>
    </main>
  );
}
