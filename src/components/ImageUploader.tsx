'use client';

import { useState } from 'react';
import JSZip from 'jszip';

interface ConvertedImage {
  name: string;
  url: string;
  format: string;
  status: 'waiting' | 'converting' | 'converted' | 'error';
  thumbnail: string;
}

export default function ImageUploader() {
  const [files, setFiles] = useState<File[]>([]);
  const [convertedImages, setConvertedImages] = useState<ConvertedImage[]>([]);
  const [format, setFormat] = useState('webp');
  const [isConverting, setIsConverting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFiles(prev => [...prev, ...newFiles]);
      
      // Create thumbnails and set initial status for new files
      const newImages = newFiles.map(file => ({
        name: file.name.split('.')[0],
        url: '',
        format,
        status: 'waiting' as const,
        thumbnail: URL.createObjectURL(file)
      }));
      setConvertedImages(prev => [...prev, ...newImages]);
    }
  };

  const clearList = () => {
    // Clean up object URLs
    convertedImages.forEach(img => URL.revokeObjectURL(img.thumbnail));
    setFiles([]);
    setConvertedImages([]);
  };

  const convertImages = async () => {
    if (files.length === 0) return;
    
    setIsConverting(true);
    const formData = new FormData();
    files.forEach(file => formData.append('images', file));
    formData.append('format', format);

    // Update status to converting
    setConvertedImages(prev => prev.map(img => ({
      ...img,
      status: 'converting'
    })));

    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Conversion failed');
      
      const data = await response.json();
      setConvertedImages(prev => prev.map((img, index) => ({
        ...img,
        url: data[index].url,
        status: 'converted'
      })));
    } catch (error) {
      console.error('Error converting images:', error);
      setConvertedImages(prev => prev.map(img => ({
        ...img,
        status: 'error'
      })));
    } finally {
      setIsConverting(false);
    }
  };

  const downloadAll = async () => {
    const convertedImagesToDownload = convertedImages.filter(img => img.status === 'converted');
    if (convertedImagesToDownload.length === 0) return;

    const zip = new JSZip();
    
    for (const image of convertedImagesToDownload) {
      const response = await fetch(image.url);
      const blob = await response.blob();
      zip.file(`${image.name}.${image.format}`, blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'converted_images.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getStatusColor = (status: ConvertedImage['status']) => {
    switch (status) {
      case 'waiting':
        return 'border-gray-300';
      case 'converting':
        return 'border-blue-500 animate-pulse';
      case 'converted':
        return 'border-green-500';
      case 'error':
        return 'border-red-500';
      default:
        return 'border-gray-300';
    }
  };

  const getStatusText = (status: ConvertedImage['status']) => {
    switch (status) {
      case 'waiting':
        return 'Waiting to convert';
      case 'converting':
        return 'Converting...';
      case 'converted':
        return 'Converted';
      case 'error':
        return 'Conversion failed';
      default:
        return '';
    }
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
              {files.length > 0 && (
                <span className="mt-2 text-sm text-blue-600">
                  {files.length} file(s) in queue
                </span>
              )}
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

            <div className="flex space-x-4">
              <button
                onClick={convertImages}
                disabled={files.length === 0 || isConverting}
                className="flex-1 flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {isConverting ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Converting...
                  </span>
                ) : (
                  'Convert Images'
                )}
              </button>
              {files.length > 0 && (
                <button
                  onClick={clearList}
                  className="flex items-center justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg
                    className="w-5 h-5 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Clear List
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Column - Results Section */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Image Queue</h2>
        {convertedImages.length > 0 ? (
          <div className="space-y-4">
            {convertedImages.map((image, index) => (
              <div
                key={index}
                className={`flex items-center space-x-4 p-4 rounded-lg border-2 ${getStatusColor(image.status)}`}
              >
                <div className="flex-shrink-0">
                  <img
                    src={image.thumbnail}
                    alt={image.name}
                    className="h-16 w-16 object-cover rounded"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {image.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {getStatusText(image.status)}
                  </p>
                </div>
                {image.status === 'converted' && (
                  <button
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = image.url;
                      a.download = `${image.name}.${image.format}`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    className="p-2 text-gray-500 hover:text-gray-700 focus:outline-none"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))}
            {convertedImages.some(img => img.status === 'converted') && (
              <button
                onClick={downloadAll}
                className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Download All as ZIP
              </button>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No images uploaded yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Upload some images to see them here
            </p>
          </div>
        )}
      </div>
    </div>
  );
} 