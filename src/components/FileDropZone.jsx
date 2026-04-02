import { useCallback, useState } from 'react';

export default function FileDropZone({ onFilesLoaded, disabled }) {
  const [dragging, setDragging] = useState(false);
  const [fileCount, setFileCount] = useState(0);

  const handleFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList).filter((f) => f.name.endsWith('.json'));
      if (files.length === 0) return;

      const results = [];
      for (const file of files) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (Array.isArray(data)) {
            results.push({ name: file.name, messages: data });
          }
        } catch (e) {
          console.warn(`Failed to parse ${file.name}:`, e);
        }
      }
      setFileCount(results.length);
      onFilesLoaded(results);
    },
    [onFilesLoaded]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const onDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDragLeave = () => setDragging(false);

  const onInputChange = (e) => {
    handleFiles(e.target.files);
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
        dragging
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-300 hover:border-gray-400'
      } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <input
        type="file"
        multiple
        accept=".json"
        onChange={onInputChange}
        className="hidden"
        id="file-input"
        disabled={disabled}
      />
      <label htmlFor="file-input" className="cursor-pointer">
        <div className="text-4xl mb-3">📁</div>
        <p className="text-lg font-medium text-gray-700">
          Drop Slack export JSON files here
        </p>
        <p className="text-sm text-gray-500 mt-1">
          or click to browse — accepts multiple .json files
        </p>
        {fileCount > 0 && (
          <p className="text-sm text-green-600 mt-3 font-medium">
            {fileCount} file{fileCount !== 1 ? 's' : ''} loaded
          </p>
        )}
      </label>
    </div>
  );
}
