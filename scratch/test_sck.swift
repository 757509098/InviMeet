import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

@available(macOS 13.0, *)
public class LoopbackManager: NSObject, SCStreamOutput, @unchecked Sendable {
    private var stream: SCStream?
    private let audioQueue = DispatchQueue(label: "com.invimeet.loopback.audio")
    private var isRecording = false

    public override init() {
        super.init()
    }

    public func startCapture() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw NSError(domain: "LoopbackManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "No display found"])
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let newStream = SCStream(filter: filter, configuration: config, delegate: nil)
        try newStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
        try await newStream.startCapture()
        self.stream = newStream
        self.isRecording = true
    }

    public func stopCapture() async {
        if let s = self.stream {
            try? await s.stopCapture()
            self.stream = nil
        }
        self.isRecording = false
    }

    public func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }

        _ = try? sampleBuffer.withAudioBufferList { audioBufferList, blockBuffer in
            guard let formatDesc = sampleBuffer.formatDescription?.audioStreamBasicDescription else { return }
            let channels = Int(formatDesc.mChannelsPerFrame)
            let sampleRate = formatDesc.mSampleRate
            _ = channels
            _ = sampleRate
        }
    }
}

@_cdecl("mac_check_screen_capture_permission")
public func mac_check_screen_capture_permission() -> Bool {
    if #available(macOS 13.0, *) {
        return CGPreflightScreenCaptureAccess()
    }
    return false
}

@_cdecl("mac_request_screen_capture_permission")
public func mac_request_screen_capture_permission() -> Bool {
    if #available(macOS 13.0, *) {
        return CGRequestScreenCaptureAccess()
    }
    return false
}
