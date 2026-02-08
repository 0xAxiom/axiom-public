import React, { useMemo, useRef } from "react";
import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import * as THREE from "three";
import {
  extractFrequencyBands,
  getAudioDataForFrame,
} from "./AudioAnalyzer";

interface AudioSphereProps {
  audioData: ReturnType<typeof import("@remotion/media-utils").useAudioData>;
  color?: string;
  radius?: number;
  detail?: number;
  wireframe?: boolean;
  showPoints?: boolean;
  baseDisplacement?: number;
  maxDisplacement?: number;
}

export const AudioSphere: React.FC<AudioSphereProps> = ({
  audioData,
  color = "#00E5FF",
  radius = 2,
  detail = 32,
  wireframe = true,
  showPoints = true,
  baseDisplacement = 0,
  maxDisplacement = 1.5,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const meshRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const originalPositions = useRef<Float32Array | null>(null);

  // Create sphere geometry
  const geometry = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(radius, detail);
    // Store original positions for displacement
    originalPositions.current = geo.attributes.position.array.slice() as Float32Array;
    return geo;
  }, [radius, detail]);

  // Get FFT data for current frame
  const fftData = useMemo(() => {
    return getAudioDataForFrame(audioData, frame, fps, 256);
  }, [audioData, frame, fps]);

  // Extract frequency bands
  const frequencies = useMemo(() => {
    return extractFrequencyBands(fftData, 256);
  }, [fftData]);

  // Intro animation - sphere scales in
  const introProgress = spring({
    frame,
    fps,
    config: {
      damping: 50,
      stiffness: 100,
    },
    durationInFrames: 30,
  });

  // Outro animation - sphere scales out
  const outroStart = durationInFrames - 30;
  const outroProgress =
    frame > outroStart
      ? spring({
          frame: frame - outroStart,
          fps,
          config: {
            damping: 50,
            stiffness: 100,
          },
          durationInFrames: 30,
        })
      : 0;

  const scale = interpolate(
    introProgress - outroProgress,
    [0, 1],
    [0, 1],
    { extrapolateRight: "clamp" }
  );

  // Apply vertex displacement based on audio
  useMemo(() => {
    if (!meshRef.current?.geometry || !originalPositions.current) return;

    const geo = meshRef.current.geometry as THREE.BufferGeometry;
    const positions = geo.attributes.position.array as Float32Array;
    const original = originalPositions.current;

    for (let i = 0; i < positions.length; i += 3) {
      const ox = original[i];
      const oy = original[i + 1];
      const oz = original[i + 2];

      // Calculate displacement based on vertex position and frequency
      const vertexAngle = Math.atan2(oy, ox);
      const vertexHeight = oz / radius;

      // Map different frequencies to different parts of the sphere
      let displacement = baseDisplacement;

      // Bass affects the equator more
      const bassInfluence = 1 - Math.abs(vertexHeight);
      displacement += frequencies.bass * maxDisplacement * 2.5 * bassInfluence;

      // Mid frequencies create ripples
      const midPhase = Math.sin(vertexAngle * 4 + frame * 0.1);
      displacement += frequencies.mid * maxDisplacement * 0.8 * midPhase;

      // Treble creates fine detail spikes
      const treblePhase = Math.sin(vertexAngle * 8 + vertexHeight * 6);
      displacement += frequencies.treble * maxDisplacement * 0.4 * treblePhase;

      // Overall energy adds uniform expansion
      displacement += frequencies.overall * maxDisplacement * 0.3;

      // Normalize and apply displacement
      const length = Math.sqrt(ox * ox + oy * oy + oz * oz);
      const nx = ox / length;
      const ny = oy / length;
      const nz = oz / length;

      positions[i] = ox + nx * displacement;
      positions[i + 1] = oy + ny * displacement;
      positions[i + 2] = oz + nz * displacement;
    }

    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();

    // Update points geometry
    if (pointsRef.current?.geometry) {
      const pointsGeo = pointsRef.current.geometry as THREE.BufferGeometry;
      pointsGeo.attributes.position.array.set(positions);
      pointsGeo.attributes.position.needsUpdate = true;
    }
  }, [frame, frequencies, baseDisplacement, maxDisplacement, radius]);

  // Slow rotation
  const rotation: [number, number, number] = [
    frame * 0.005,
    frame * 0.008,
    0,
  ];

  // Emissive intensity based on audio
  const emissiveIntensity = interpolate(
    frequencies.overall,
    [0, 0.5],
    [0.2, 1],
    { extrapolateRight: "clamp" }
  );

  return (
    <group scale={scale} rotation={rotation}>
      {/* Wireframe mesh */}
      {wireframe && (
        <mesh ref={meshRef} geometry={geometry}>
          <meshBasicMaterial
            color={color}
            wireframe={true}
            transparent={true}
            opacity={0.6}
          />
        </mesh>
      )}

      {/* Points/particles on vertices */}
      {showPoints && (
        <points ref={pointsRef} geometry={geometry}>
          <pointsMaterial
            color={color}
            size={0.03}
            transparent={true}
            opacity={0.8}
            sizeAttenuation={true}
          />
        </points>
      )}

      {/* Inner glow core */}
      <mesh>
        <icosahedronGeometry args={[radius * 0.3, 16]} />
        <meshBasicMaterial
          color={color}
          transparent={true}
          opacity={0.15 + emissiveIntensity * 0.2}
        />
      </mesh>
    </group>
  );
};

export default AudioSphere;
