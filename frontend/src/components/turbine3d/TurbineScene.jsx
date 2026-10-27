import { useRef } from 'react';
import PropTypes from 'prop-types';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { approachAngle, bearingToXZ, headingToRotationY, TURBINE_PARTS } from '../../utils/turbine3d.js';

const YAW_RATE = 0.6;          // radians per second the nacelle may turn: slow, like a real yaw drive
const RING = 14;               // radius (scene units) of the compass ring on the ground

const PART_COLOR = Object.fromEntries(TURBINE_PARTS.map((p) => [p.id, p.color]));

/** Material for one part: its own colour, glowing while it is hovered in the legend. */
function PartMaterial({ part, highlight, roughness = 0.45 }) {
  const on = highlight === part;
  return <meshStandardMaterial color={PART_COLOR[part]} roughness={roughness} emissive={PART_COLOR[part]} emissiveIntensity={on ? 0.85 : 0} />;
}
PartMaterial.propTypes = { part: PropTypes.string.isRequired, highlight: PropTypes.string, roughness: PropTypes.number };

/** The nacelle, hub and blades. Turns toward the advised heading and spins at the illustrative rotor speed. */
function Turbine({ scene, size, animate, highlight }) {
  const nacelle = useRef();
  const rotor = useRef();
  const yaw = useRef(headingToRotationY(scene.heading ?? 0));
  const target = scene.heading === null ? null : headingToRotationY(scene.heading);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.1);
    if (target !== null) yaw.current = animate ? approachAngle(yaw.current, target, YAW_RATE * step) : target;
    if (nacelle.current) nacelle.current.rotation.y = yaw.current;
    if (rotor.current && animate) rotor.current.rotation.z -= (scene.rpm * 2 * Math.PI / 60) * step;
  });

  const L = size.bladeLength;
  return (
    <group>
      <mesh position={[0, size.hub / 2, 0]}>
        <cylinderGeometry args={[0.22, 0.4, size.hub, 24]} />
        <PartMaterial part="tower" highlight={highlight} roughness={0.55} />
      </mesh>
      <mesh position={[0, size.hub - 0.47, 0]}>
        <cylinderGeometry args={[0.58, 0.58, 0.24, 32]} />
        <PartMaterial part="yaw" highlight={highlight} roughness={0.4} />
      </mesh>
      <group ref={nacelle} position={[0, size.hub, 0]}>
        <mesh position={[0, 0, -0.2]}>
          <boxGeometry args={[0.7, 0.7, 1.9]} />
          <PartMaterial part="nacelle" highlight={highlight} />
        </mesh>
        <group position={[0, 0, 0.95]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.25]}>
            <coneGeometry args={[0.4, 0.8, 24]} />
            <PartMaterial part="hub" highlight={highlight} roughness={0.35} />
          </mesh>
          <group ref={rotor} position={[0, 0, 0.1]}>
            {[0, 120, 240].map((deg) => (
              <group key={deg} rotation={[0, 0, (deg * Math.PI) / 180]}>
                <mesh position={[0, 0.3 + L / 2, 0]}>
                  <boxGeometry args={[0.55, L, 0.09]} />
                  <PartMaterial part="blades" highlight={highlight} roughness={0.4} />
                </mesh>
              </group>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}
Turbine.propTypes = { scene: PropTypes.object.isRequired, size: PropTypes.object.isRequired, animate: PropTypes.bool.isRequired, highlight: PropTypes.string };

/** Arrow on the upwind side pointing at the tower: the direction the wind blows TO is the opposite of the forecast "from" angle. */
function WindArrow({ windFrom, reliable, colors }) {
  const [x, z] = bearingToXZ(windFrom, RING + 3);
  const tone = reliable ? colors.accent : colors.muted;
  return (
    <group position={[x, 0.6, z]} rotation={[0, headingToRotationY(windFrom + 180), 0]}>
      <mesh position={[0, 0, -1.1]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 2.2, 12]} />
        <meshStandardMaterial color={tone} transparent opacity={reliable ? 1 : 0.45} />
      </mesh>
      <mesh position={[0, 0, 0.4]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.4, 0.9, 16]} />
        <meshStandardMaterial color={tone} transparent opacity={reliable ? 1 : 0.45} />
      </mesh>
    </group>
  );
}
WindArrow.propTypes = { windFrom: PropTypes.number.isRequired, reliable: PropTypes.bool, colors: PropTypes.object.isRequired };

function Ground({ colors }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[RING + 6, 64]} />
        <meshStandardMaterial color={colors.grid} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[RING - 0.06, RING + 0.06, 96]} />
        <meshBasicMaterial color={colors.border} />
      </mesh>
      {[['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([label, deg]) => {
        const [x, z] = bearingToXZ(deg, RING + 1.8);
        return <Html key={label} position={[x, 0.1, z]} center className="scene-label" zIndexRange={[5, 0]}>{label}</Html>;
      })}
    </group>
  );
}
Ground.propTypes = { colors: PropTypes.object.isRequired };

/** Marker on the ring where the advisory nacelle heading points (purple, like the compass). */
function HeadingMarker({ heading, colors }) {
  const [x, z] = bearingToXZ(heading, RING);
  return (
    <mesh position={[x, 0.45, z]}>
      <sphereGeometry args={[0.45, 20, 20]} />
      <meshStandardMaterial color={colors.accent2} emissive={colors.accent2} emissiveIntensity={0.4} />
    </mesh>
  );
}
HeadingMarker.propTypes = { heading: PropTypes.number.isRequired, colors: PropTypes.object.isRequired };

/** The whole 3D view. `resetKey` changes to put the camera back to its starting position. */
export default function TurbineScene({ scene, size, colors, animate, resetKey, large = false, highlight }) {
  const reach = size.hub + size.bladeLength;
  const dist = Math.max(26, reach * (large ? 2.05 : 2.25));                                  // far enough to keep the blade tips in view
  // Start 40 degrees off the rotor axis so the rotor is seen from the front-side, not edge-on (the user can orbit freely).
  const [cx, cz] = bearingToXZ((scene.heading ?? scene.windFrom ?? 0) + 40, dist);
  return (
    <Canvas key={resetKey} camera={{ position: [cx, reach * 0.55, cz], fov: 42, near: 0.1, far: 400 }} dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true }} frameloop={animate ? 'always' : 'demand'}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[12, 20, 8]} intensity={1.4} />
      <Ground colors={colors} />
      <Turbine scene={scene} size={size} animate={animate} highlight={highlight} />
      {scene.windFrom != null && <WindArrow windFrom={scene.windFrom} reliable={scene.reliable} colors={colors} />}
      {scene.heading !== null && <HeadingMarker heading={scene.heading} colors={colors} />}
      <OrbitControls target={[0, size.hub * 0.55, 0]} enablePan={false} minDistance={12} maxDistance={Math.max(90, dist * 2)} maxPolarAngle={Math.PI / 2 - 0.03} />
    </Canvas>
  );
}
TurbineScene.propTypes = {
  scene: PropTypes.object.isRequired, size: PropTypes.object.isRequired, colors: PropTypes.object.isRequired,
  animate: PropTypes.bool.isRequired, resetKey: PropTypes.number, large: PropTypes.bool, highlight: PropTypes.string,
};
