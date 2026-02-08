import React, { Suspense } from "react";
import { AbsoluteFill, Audio, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useAudioData } from "@remotion/media-utils";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { z } from "zod";
import { AudioSphere } from "./AudioSphere";

export const sphereVizSchema = z.object({
  audioSrc: z.string(),
  backgroundColor: z.string().default("#0A0C10"),
  sphereColor: z.string().default("#00E5FF"),
  sphereDetail: z.number().default(32),
  showWireframe: z.boolean().default(true),
  showPoints: z.boolean().default(true),
});

export type SphereVizProps = z.infer<typeof sphereVizSchema>;

const Scene: React.FC<{ audioData: ReturnType<typeof useAudioData>; props: SphereVizProps }> = ({
  audioData,
  props,
}) => {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={0.5} />

      {/* Audio-reactive sphere */}
      <AudioSphere
        audioData={audioData}
        color={props.sphereColor}
        radius={2}
        detail={props.sphereDetail}
        wireframe={props.showWireframe}
        showPoints={props.showPoints}
        baseDisplacement={0}
        maxDisplacement={1.2}
      />

      {/* Post-processing bloom effect */}
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.1}
          luminanceSmoothing={0.9}
          intensity={1.5}
          radius={0.8}
        />
      </EffectComposer>
    </>
  );
};

export const SphereViz: React.FC<SphereVizProps> = (props) => {
  const { width, height } = useVideoConfig();
  
  // Load audio data for visualization
  const audioData = useAudioData(props.audioSrc);

  return (
    <AbsoluteFill style={{ backgroundColor: props.backgroundColor }}>
      {/* Three.js Canvas */}
      <ThreeCanvas
        width={width}
        height={height}
        camera={{ position: [0, 0, 6], fov: 50 }}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={null}>
          <Scene audioData={audioData} props={props} />
        </Suspense>
      </ThreeCanvas>

      {/* Audio track */}
      <Audio src={props.audioSrc} />
    </AbsoluteFill>
  );
};

export default SphereViz;
