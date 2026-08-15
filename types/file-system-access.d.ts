interface FileSystemHandle {
  queryPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>
  requestPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>
}

interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream<BufferSource | Blob | string> {
  write(data: BufferSource | Blob | string): Promise<void>
  close(): Promise<void>
}

interface Window {
  showDirectoryPicker(options?: { mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>
}
