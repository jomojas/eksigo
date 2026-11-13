import Foundation

/// Downloads a file to a destination with progress, through a delegate session
/// (the async `URLSession.download` API reports no progress).
nonisolated final class Downloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    static let shared = Downloader()

    private struct Job {
        let destination: URL
        let progress: @Sendable (Double) -> Void
        let continuation: CheckedContinuation<Void, Error>
    }

    private let lock = NSLock()
    // Guarded by `lock`.
    nonisolated(unsafe) private var jobs: [Int: Job] = [:]
    nonisolated(unsafe) private var _session: URLSession?
    private var session: URLSession {
        lock.withLock {
            if let s = _session { return s }
            let s = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
            _session = s
            return s
        }
    }

    func download(_ url: URL, to destination: URL, progress: @escaping @Sendable (Double) -> Void) async throws {
        let task = session.downloadTask(with: url)
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.withLock { jobs[task.taskIdentifier] = Job(destination: destination, progress: progress, continuation: continuation) }
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }
    }

    private func take(_ task: URLSessionTask) -> Job? {
        lock.withLock { jobs.removeValue(forKey: task.taskIdentifier) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let job = lock.withLock { jobs[downloadTask.taskIdentifier] }
        job?.progress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let job = take(downloadTask) else { return }
        do {
            if let http = downloadTask.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                throw APIError(status: http.statusCode, message: "Download failed (\(http.statusCode))")
            }
            // The temporary file is deleted when this method returns, so move it now.
            let fm = FileManager.default
            try fm.createDirectory(at: job.destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? fm.removeItem(at: job.destination)
            try fm.moveItem(at: location, to: job.destination)
            job.progress(1)
            job.continuation.resume()
        } catch {
            job.continuation.resume(throwing: error)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // Success already resumed in didFinishDownloadingTo; only failures are left here.
        if let error, let job = take(task) { job.continuation.resume(throwing: error) }
    }
}
