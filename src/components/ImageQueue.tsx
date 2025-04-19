import { useEffect, useState } from 'react';
import Image from 'next/image';

export interface QueueImage {
  name: string;
  url: string;
  format: string;
  status: 'waiting' | 'converting' | 'converted' | 'error';
  thumbnail: string;
  fileObj?: File; // Only for waiting items
  originalSize?: number;
  convertedSize?: number;
  reconvertFrom?: string; // If this is a reconvert, the original file name
}

interface ImageQueueProps {
  format: string;
  setFormat: (format: string) => void;
  sessionId: string;
  onClear: () => void;
  newFiles: File[];
  setNewFiles: (files: File[]) => void;
}

export default function ImageQueue({ format, setFormat, sessionId, onClear, newFiles, setNewFiles }: ImageQueueProps) {
  const [queue, setQueue] = useState<QueueImage[]>([]);
  const [isConverting, setIsConverting] = useState(false);

  // Fetch persisted files on mount
  useEffect(() => {
    fetch(`/api/convert?sessionId=${sessionId}`)
      .then(res => res.json())
      .then(data => {
        if (data.files && Array.isArray(data.files)) {
          setQueue(data.files.map((file: { name: string; file: string; format: string; thumbnail: string; originalSize: number; convertedSize: number }) => ({
            name: file.name,
            url: `/api/download?session=${sessionId}&file=${encodeURIComponent(file.file)}`,
            format: file.format,
            status: 'converted',
            thumbnail: file.thumbnail ? `/api/thumbnail?session=${sessionId}&file=${encodeURIComponent(file.thumbnail)}` : '',
            originalSize: file.originalSize,
            convertedSize: file.convertedSize
          })));
        }
      });
  }, [sessionId]);

  // Add new files to queue as waiting
  useEffect(() => {
    if (newFiles.length > 0) {
      setQueue(prev => {
        const updatedQueue = [...prev];
        newFiles.forEach(file => {
          const ext = file.name.split('.').pop() || '';
          const baseName = file.name.replace(/\.[^/.]+$/, '');
          let uniqueName = baseName;
          let counter = 1;
          // Find a unique name
          while (updatedQueue.some(q => q.name === uniqueName && q.format === format)) {
            uniqueName = `${baseName} (${counter})`;
            counter++;
          }
          // Create a new File object with the unique name
          const newFile = new File([file], `${uniqueName}.${ext}`, { type: file.type });
          updatedQueue.push({
            name: uniqueName,
            url: '',
            format,
            status: 'waiting' as const,
            thumbnail: URL.createObjectURL(newFile),
            fileObj: newFile
          });
        });
        return updatedQueue;
      });
      setNewFiles([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newFiles]);

  // Convert only waiting items
  const convertImages = async () => {
    const waiting = queue.filter(img => img.status === 'waiting');
    if (waiting.length === 0) return;
    setIsConverting(true);
    const formData = new FormData();
    waiting.forEach(img => {
      if (img.fileObj) {
        formData.append('images', img.fileObj);
      } else if (img.reconvertFrom) {
        formData.append('reconvertFrom[]', img.reconvertFrom);
        formData.append('reconvertName[]', img.name);
      }
    });
    formData.append('format', format);
    formData.append('sessionId', sessionId);
    // Mark as converting
    setQueue(prev => prev.map(img => img.status === 'waiting' ? { ...img, status: 'converting' } : img));
    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Conversion failed');
      const data = await response.json();
      console.log('Conversion response:', data); // Log the response for debugging
      // Remove waiting/converting items, add new converted
      setQueue(prev => [
        ...prev.filter(img => img.status === 'converted'),
        ...data.files.map((file: { name: string; file: string; format: string; thumbnail: string; originalSize: number; convertedSize: number }) => {
          console.log('Processing file from response:', file); // Log each file
          return {
            name: file.name, // display name
            url: `/api/download?session=${sessionId}&file=${encodeURIComponent(file.file)}`, // use file path from API for URL
            format: file.format,
            status: 'converted',
            thumbnail: file.thumbnail ? `/api/thumbnail?session=${sessionId}&file=${encodeURIComponent(file.thumbnail)}` : '',
            originalSize: file.originalSize,
            convertedSize: file.convertedSize
          };
        })
      ]);
    } catch (error) {
      console.error('Conversion error:', error); // Log any errors
      setQueue(prev => prev.map(img => img.status === 'converting' ? { ...img, status: 'error' } : img));
    } finally {
      setIsConverting(false);
    }
  };

  // Download all converted
  const downloadAll = async () => {
    const converted = queue.filter(img => img.status === 'converted');
    if (converted.length === 0) return;
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const image of converted) {
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

  // Delete a single file from the backend and remove from queue
  const deleteFile = async (fileName: string) => {
    await fetch(`/api/convert?sessionId=${sessionId}&file=${encodeURIComponent(fileName)}`, { method: 'DELETE' });
    setQueue(prev => prev.filter(img => img.name !== fileName));
  };

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      queue.forEach(img => img.thumbnail && img.status === 'waiting' && URL.revokeObjectURL(img.thumbnail));
    };
  }, [queue]);

  // Helper to format bytes
  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Image Queue</h2>
      {queue.length > 0 ? (
        <div className="space-y-4">
          {queue.map((image, index) => (
            <div
              key={index}
              className={`flex items-center space-x-4 p-4 rounded-lg border-2 ${
                image.status === 'waiting' ? 'border-gray-300' :
                image.status === 'converting' ? 'border-blue-500 animate-pulse' :
                image.status === 'converted' ? 'border-green-500' :
                image.status === 'error' ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <div className="flex-shrink-0">
                {image.thumbnail ? (
                  <Image
                    src={image.thumbnail}
                    alt={image.name}
                    className="h-16 w-16 object-cover rounded"
                    width={64}
                    height={64}
                  />
                ) : (
                  <div className="h-16 w-16 flex items-center justify-center bg-gray-200 rounded">
                    <span className="text-gray-400 text-xs">No preview</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {image.name}
                </p>
                <p className="text-xs text-gray-500">
                  {image.status === 'waiting' ? 'Waiting to convert' :
                   image.status === 'converting' ? 'Converting...' :
                   image.status === 'converted' ? 'Converted' :
                   image.status === 'error' ? 'Conversion failed' : ''}
                </p>
                {image.status === 'converted' && image.originalSize && image.convertedSize && (
                  <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                    <span>{formatBytes(image.originalSize)} → {formatBytes(image.convertedSize)}</span>
                    {(() => {
                      const percent = image.originalSize > 0 ? ((100 * (image.originalSize - image.convertedSize) / image.originalSize)) : 0;
                      const isReduced = percent >= 0;
                      return (
                        <span
                          className={`px-2 py-0.5 rounded text-white font-semibold ${isReduced ? 'bg-green-500' : 'bg-red-500'}`}
                        >
                          ~ {Math.abs(percent).toFixed(1)}%
                        </span>
                      );
                    })()}
                  </div>
                )}
              </div>
              {image.status === 'converted' && (
                <>
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
                  <button
                    onClick={() => {
                      setQueue(prev => {
                        // Use a date-time suffix for uniqueness
                        const baseName = image.name;
                        const now = new Date();
                        const pad = (n: number) => n.toString().padStart(2, '0');
                        const dateSuffix = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                        const newName = `${baseName}_${dateSuffix}`;
                        // Add a new waiting entry referencing the same original (no fileObj, but mark as waiting)
                        return [
                          ...prev,
                          {
                            name: newName,
                            url: '',
                            format: image.format,
                            status: 'waiting',
                            thumbnail: image.thumbnail, // reuse thumbnail for now
                            fileObj: undefined,
                            originalSize: image.originalSize,
                            convertedSize: undefined,
                            reconvertFrom: image.name // mark the original name
                          }
                        ];
                      });
                    }}
                    className="p-2 text-blue-500 hover:text-blue-700 focus:outline-none ml-2"
                    title="Reconvert file"
                  >
                    {/* Refresh/redo icon */}
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
                        d="M4 4v5h.582M20 20v-5h-.581M5.5 19A9 9 0 0020 15.5M18.364 5.636A9 9 0 004 8.5"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteFile(image.name)}
                    className="p-2 text-red-500 hover:text-red-700 focus:outline-none ml-2"
                    title="Delete file"
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
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </>
              )}
            </div>
          ))}
          {queue.some(img => img.status === 'converted') && (
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
      <div className="flex flex-col gap-4 mt-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Output Format
          </label>
          <select
            value={format}
            onChange={e => setFormat(e.target.value)}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="webp">WebP (Modern, High Quality)</option>
            <option value="jpeg">JPEG (Compatible, Good Quality)</option>
            <option value="png">PNG (Lossless, High Quality)</option>
          </select>
        </div>
        <div className="flex justify-between">
          <button
            onClick={convertImages}
            disabled={isConverting || !queue.some(img => img.status === 'waiting')}
            className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
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
          <button
            onClick={async () => {
              queue.forEach(img => img.thumbnail && img.status === 'waiting' && URL.revokeObjectURL(img.thumbnail));
              await fetch(`/api/convert?sessionId=${sessionId}`, { method: 'DELETE' });
              setQueue([]);
              onClear();
            }}
            className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Clear Queue
          </button>
        </div>
      </div>
    </div>
  );
} 