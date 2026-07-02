"use client";

/**
 * TEMPORARY TEST PAGE — for local testing of LiveCameraCapture + PhotoGallery.
 * Remove after testing PR #350.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import LiveCameraCapture, { type CapturedPhoto } from "@/components/LiveCameraCapture";
import PhotoGallery, { type GalleryPhoto } from "@/components/files/PhotoGallery";

export default function TestCameraPage() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [fakeStreamReady, setFakeStreamReady] = useState(false);
  const idCounter = useRef(0);

  // Install fake getUserMedia on mount
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    let frame = 0;

    function drawFrame() {
      frame++;
      ctx.fillStyle = "#1a1a2e";
      ctx.fillRect(0, 0, 640, 480);
      // Animated gradient background
      const grad = ctx.createLinearGradient(0, 0, 640, 480);
      grad.addColorStop(0, `hsl(${(frame * 2) % 360}, 50%, 20%)`);
      grad.addColorStop(1, `hsl(${(frame * 2 + 180) % 360}, 50%, 15%)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 640, 480);

      ctx.fillStyle = "#e94560";
      ctx.font = "bold 36px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("FAKE CAMERA", 320, 180);
      ctx.fillStyle = "#ffffff";
      ctx.font = "20px sans-serif";
      ctx.fillText("Test Stream for Video Recording", 320, 220);
      ctx.fillStyle = "#16e3d2";
      ctx.font = "bold 24px sans-serif";
      ctx.fillText(new Date().toLocaleTimeString(), 320, 270);
      // Moving circle to show animation
      const cx = 320 + Math.cos(frame * 0.05) * 150;
      const cy = 360 + Math.sin(frame * 0.05) * 50;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.fillStyle = "#f7dc6f";
      ctx.fill();
      requestAnimationFrame(drawFrame);
    }
    drawFrame();

    const fakeVideoStream = canvas.captureStream(30);

    // Add a silent audio track
    const audioCtx = new AudioContext();
    const oscillator = audioCtx.createOscillator();
    oscillator.frequency.value = 0; // silent
    const dest = audioCtx.createMediaStreamDestination();
    oscillator.connect(dest);
    oscillator.start();

    // Patch the original video track with torch/zoom capabilities and no-op stop
    const videoTrack = fakeVideoStream.getVideoTracks()[0];
    if (videoTrack) {
      const origGetCaps = videoTrack.getCapabilities?.bind(videoTrack);
      videoTrack.getCapabilities = () => {
        const caps = origGetCaps?.() || {};
        return { ...caps, torch: true, zoom: { min: 1, max: 10 } };
      };
      videoTrack.applyConstraints = async () => {};
      // No-op stop so component cleanup doesn't kill the canvas stream
      videoTrack.stop = () => { console.log("[FAKE] video track.stop() (no-op)"); };
    }

    // No-op stop on audio track too
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.stop = () => { console.log("[FAKE] audio track.stop() (no-op)"); };
    }

    // Override getUserMedia — return the ORIGINAL streams (not clones)
    // so MediaRecorder gets tracks that actually produce frames
    navigator.mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
      console.log("[FAKE] getUserMedia called:", JSON.stringify(constraints));

      // If only audio requested, return the audio stream
      if (constraints.audio && !constraints.video) {
        return dest.stream;
      }

      // For video requests, return the original canvas stream
      return fakeVideoStream;
    };

    setFakeStreamReady(true);

    return () => {
      audioCtx.close();
    };
  }, []);

  const handleCapture = useCallback((photo: CapturedPhoto) => {
    idCounter.current += 1;
    const newPhoto: GalleryPhoto = {
      id: `test-${idCounter.current}`,
      name: photo.name,
      dataUrl: photo.dataUrl,
      photoType: "Job Photo",
      uploadedBy: "Test User",
      uploadedAt: new Date().toISOString(),
      jobAddress: "123 Test St, Phoenix, AZ",
    };
    setPhotos((prev) => [...prev, newPhoto]);
    console.log("[TEST] Captured:", photo.name, "dataUrl length:", photo.dataUrl.length);
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        idCounter.current += 1;
        const newPhoto: GalleryPhoto = {
          id: `upload-${idCounter.current}`,
          name: file.name,
          dataUrl: reader.result as string,
          photoType: "Job Photo",
          uploadedBy: "Test User",
          uploadedAt: new Date().toISOString(),
          jobAddress: "123 Test St, Phoenix, AZ",
        };
        setPhotos((prev) => [...prev, newPhoto]);
        console.log("[TEST] Uploaded:", file.name);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-2 text-2xl font-bold text-blue-700">Camera & Video Test Page</h1>
        <p className="mb-6 text-sm text-gray-500">
          Temporary test page for PR #350 — Camera video recording + gallery video display.
          {fakeStreamReady ? " ✓ Fake camera ready." : " ⏳ Setting up fake camera..."}
        </p>

        {/* Action buttons */}
        <div className="mb-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setCameraOpen(true)}
            disabled={!fakeStreamReady}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow hover:bg-blue-700 active:scale-95 disabled:opacity-50"
          >
            📷 Open Camera
          </button>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-green-600 px-5 py-3 text-sm font-bold text-white shadow hover:bg-green-700 active:scale-95">
            📁 Upload File
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>

          <span className="self-center text-sm font-semibold text-gray-600">
            {photos.length} item{photos.length !== 1 ? "s" : ""} in gallery
          </span>
        </div>

        {/* Photo Gallery */}
        {photos.length > 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-lg font-bold text-gray-700">Gallery</h2>
            <PhotoGallery photos={photos} />
          </div>
        )}

        {photos.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center">
            <p className="text-lg font-bold text-gray-400">No photos or videos yet</p>
            <p className="mt-1 text-sm text-gray-400">Use the Camera or Upload button above</p>
          </div>
        )}
      </div>

      {/* Camera overlay */}
      {cameraOpen && (
        <LiveCameraCapture
          label="Test"
          accentColor="bg-blue-600"
          onCapture={handleCapture}
          onClose={() => setCameraOpen(false)}
          existingCount={photos.length}
          jobAddress="123 Test St, Phoenix, AZ"
        />
      )}
    </div>
  );
}
