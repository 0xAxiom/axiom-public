import { Composition, staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { SphereViz, sphereVizSchema } from "./SphereViz";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Audio-Reactive Sphere Visualization */}
      <Composition
        id="SphereViz"
        component={SphereViz}
        fps={30}
        durationInFrames={300}
        width={1920}
        height={1080}
        schema={sphereVizSchema}
        defaultProps={{
          audioSrc: staticFile("audio.mp3"),
          backgroundColor: "#0A0C10",
          sphereColor: "#00E5FF",
          sphereDetail: 32,
          showWireframe: true,
          showPoints: true,
        }}
        calculateMetadata={async ({ props }) => {
          // Auto-detect audio duration
          try {
            const duration = await getAudioDurationInSeconds(props.audioSrc);
            return {
              durationInFrames: Math.ceil(duration * 30),
            };
          } catch {
            // Fallback duration if audio not found
            return { durationInFrames: 300 };
          }
        }}
      />

      {/* Square format for social media */}
      <Composition
        id="SphereVizSquare"
        component={SphereViz}
        fps={30}
        durationInFrames={300}
        width={1080}
        height={1080}
        schema={sphereVizSchema}
        defaultProps={{
          audioSrc: staticFile("audio.mp3"),
          backgroundColor: "#0A0C10",
          sphereColor: "#00E5FF",
          sphereDetail: 32,
          showWireframe: true,
          showPoints: true,
        }}
        calculateMetadata={async ({ props }) => {
          try {
            const duration = await getAudioDurationInSeconds(props.audioSrc);
            return {
              durationInFrames: Math.ceil(duration * 30),
            };
          } catch {
            return { durationInFrames: 300 };
          }
        }}
      />
    </>
  );
};
