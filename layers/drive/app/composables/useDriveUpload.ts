/** One in-flight upload, so the explorer can show its progress. */
export interface DriveUpload {
  id: string
  name: string
  /** 0–1, or undefined while the server is still receiving metadata */
  progress: number
}

/**
 * Uploads files to a folder with progress. XMLHttpRequest is used instead of
 * `$fetch` because only it reports upload progress for a streaming body.
 */
export function useDriveUpload() {
  const uploads = ref<DriveUpload[]>([])

  async function upload(service: string, path: string, files: File[]): Promise<void> {
    if (!files.length) {
      return
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const name = files.length === 1 ? files[0]!.name : `${files.length} files`
    uploads.value = [...uploads.value, { id, name, progress: 0 }]

    try {
      await send(service, path, files, (progress) => {
        uploads.value = uploads.value.map(item => item.id === id ? { ...item, progress } : item)
      })
    } finally {
      uploads.value = uploads.value.filter(item => item.id !== id)
    }
  }

  return { uploads, upload }
}

function send(service: string, path: string, files: File[], onProgress: (progress: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const file of files) {
      form.append('file', file, file.name)
    }

    const xhr = new XMLHttpRequest()
    const params = new URLSearchParams({ service, path })
    xhr.open('POST', `/api/drive/upload?${params.toString()}`)

    xhr.upload.onprogress = (progress) => {
      if (progress.lengthComputable) {
        onProgress(progress.loaded / progress.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(errorMessage(xhr.responseText) ?? 'Upload failed'))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.send(form)
  })
}

function errorMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { statusMessage?: string, message?: string }
    return parsed.statusMessage ?? parsed.message
  } catch {
    return undefined
  }
}
