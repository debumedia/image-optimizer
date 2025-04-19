'use client';

import { useState, useEffect } from 'react';
import JSZip from 'jszip';
import Image from 'next/image';
import Cookies from 'js-cookie';
import { v4 as uuidv4 } from 'uuid';
import ImageQueue from './ImageQueue';

interface ConvertedImage {
  name: string;
  url: string;
  format: string;
  status: 'waiting' | 'converting' | 'converted' | 'error';
  thumbnail: string;
}

export default function ImageUploader() {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState('webp');
  const [sessionId, setSessionId] = useState('');

  useEffect(() => {
    let session = Cookies.get('image_optimizer_session');
    if (!session) {
      session = uuidv4();
      Cookies.set('image_optimizer_session', session, { expires: 365 });
    }
    setSessionId(session);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const clearList = () => {
    setFiles([]);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Left Column - Upload Section */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Upload Images</h2>
        <div className="space-y-6">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="cursor-pointer flex flex-col items-center"
            >
              <svg
                className="w-12 h-12 text-gray-400 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <span className="text-sm text-gray-600">
                Drag and drop images here, or click to select files
              </span>
            </label>
          </div>
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              Output Format
            </label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="webp">WebP (Modern, High Quality)</option>
              <option value="jpeg">JPEG (Compatible, Good Quality)</option>
              <option value="png">PNG (Lossless, High Quality)</option>
            </select>
          </div>
        </div>
      </div>
      {/* Right Column - Image Queue */}
      <ImageQueue
        format={format}
        sessionId={sessionId}
        onClear={clearList}
        newFiles={files}
        setNewFiles={setFiles}
      />
    </div>
  );
} 