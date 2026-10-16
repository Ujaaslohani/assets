import {useFrame} from '@react-three/fiber';
import {forwardRef, useRef} from 'react';
import * as THREE from 'three';

/** Stable defaults: a fresh array each render would fight imperative updates. */
const DEFAULT_POSITION: [number, number, number] = [0, 0, 0];
const DEFAULT_ROTATION: [number, number, number] = [0, 0, 0];

/**
 * Props for the HumanoidCharacter component.
 */
export interface HumanoidCharacterProps {
  /**
   * Static placement only. For a character that moves every frame, leave this
   * unset and drive the transform through the forwarded ref (or a parent
   * group) inside useFrame — see PlayerRig in Game.tsx. Feeding a per-frame
   * position in here does nothing: React skips the update and the character
   * stays where it spawned.
   */
  position?: [number, number, number];
  rotation?: [number, number, number];
  state?: 'idle' | 'walk' | 'run' | 'action';
  toolType?: 'none' | 'pickaxe' | 'sword';
  skinColor?: string;
  clothesColor?: string;
  pantsColor?: string;
  /**
   * Whether the character casts shadows from the scene's sun light. Defaults
   * to true; turn it off for large crowds to save shadow-map draw calls.
   */
  castShadow?: boolean;
}

/**
 * Procedural geometric humanoid character with animations.
 *
 * The model faces -Z, so a heading computed with Math.atan2(dx, dz) needs a
 * + Math.PI when it is applied to rotation.y.
 *
 * The ref is forwarded to the root group so callers can move the character
 * imperatively:
 *   const ref = useRef<THREE.Group>(null);
 *   useFrame(() => void ref.current?.position.set(x, y, z));
 *   <HumanoidCharacter ref={ref} state="walk" />
 */
export const HumanoidCharacter = forwardRef<
  THREE.Group,
  HumanoidCharacterProps
>(function HumanoidCharacter(
  {
    position = DEFAULT_POSITION,
    rotation = DEFAULT_ROTATION,
    state = 'idle',
    toolType = 'none',
    skinColor = '#fcd5b5',
    clothesColor = '#3b82f6',
    pantsColor = '#1e3a8a',
    castShadow = true,
  }: HumanoidCharacterProps,
  ref,
) {
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);

  useFrame(({clock}) => {
    const t = clock.getElapsedTime();
    const speed = state === 'run' ? 15 : 8;
    const isAction = state === 'action';
    // Only locomotion states swing the legs; 'action' (mining, chopping,
    // attacking) is performed standing still.
    const intensity = state === 'run' ? 0.8 : state === 'walk' ? 0.4 : 0;

    if (
      leftLeg.current &&
      rightLeg.current &&
      leftArm.current &&
      rightArm.current
    ) {
      leftLeg.current.rotation.x = Math.sin(t * speed) * intensity;
      rightLeg.current.rotation.x = Math.sin(t * speed + Math.PI) * intensity;

      if (!isAction) {
        leftArm.current.rotation.x = Math.sin(t * speed + Math.PI) * intensity;
        rightArm.current.rotation.x = Math.sin(t * speed) * intensity;
      } else {
        // Simple chop/action animation
        rightArm.current.rotation.x = -Math.abs(Math.sin(t * 12)) * 1.5;
        leftArm.current.rotation.x = 0;
      }
    }
  });

  return (
    <group ref={ref} position={position} rotation={rotation}>
      {/* Head */}
      <mesh position={[0, 1.8, 0]} castShadow={castShadow}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color={skinColor} />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 1.1, 0]} castShadow={castShadow}>
        <capsuleGeometry args={[0.25, 0.5, 4, 8]} />
        <meshStandardMaterial color={clothesColor} />
      </mesh>

      {/* Arms */}
      <group ref={leftArm} position={[-0.35, 1.4, 0]}>
        <Limb color={skinColor} castShadow={castShadow} />
      </group>
      <group ref={rightArm} position={[0.35, 1.4, 0]}>
        <Limb
          color={skinColor}
          hasTool={toolType !== 'none'}
          toolType={toolType}
          castShadow={castShadow}
        />
      </group>

      {/* Legs */}
      <group ref={leftLeg} position={[-0.15, 0.7, 0]}>
        <Limb color={pantsColor} isLeg castShadow={castShadow} />
      </group>
      <group ref={rightLeg} position={[0.15, 0.7, 0]}>
        <Limb color={pantsColor} isLeg castShadow={castShadow} />
      </group>
    </group>
  );
});

function Limb({
  color,
  hasTool,
  toolType,
  isLeg,
  castShadow,
}: {
  color: string;
  hasTool?: boolean;
  toolType?: string;
  isLeg?: boolean;
  castShadow: boolean;
}) {
  return (
    <group>
      <mesh position={[0, -0.35, 0]} castShadow={castShadow}>
        <cylinderGeometry args={[0.07, 0.06, 0.7]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {isLeg && (
        // Legs hang from a hip pivot at y=0.7, so a 0.1-tall shoe centred at
        // -0.65 spans world y 0..0.1 and rests exactly on the ground.
        <mesh position={[0, -0.65, -0.1]} castShadow={castShadow}>
          <boxGeometry args={[0.16, 0.1, 0.3]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      )}
      {hasTool && toolType === 'sword' && (
        <mesh
          position={[0, -0.8, -0.3]}
          rotation={[Math.PI / 2, 0, 0]}
          castShadow={castShadow}>
          <boxGeometry args={[0.04, 0.8, 0.1]} />
          <meshStandardMaterial color="#ccc" metalness={0.8} roughness={0.2} />
        </mesh>
      )}
      {hasTool && toolType === 'pickaxe' && (
        <group position={[0, -0.7, -0.3]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh castShadow={castShadow}>
            <cylinderGeometry args={[0.02, 0.02, 0.8]} />
            <meshStandardMaterial color="#8B5A2B" />
          </mesh>
          <mesh
            position={[0, 0.3, 0]}
            rotation={[0, 0, Math.PI / 2]}
            castShadow={castShadow}>
            <boxGeometry args={[0.05, 0.5, 0.05]} />
            <meshStandardMaterial color="#777" />
          </mesh>
        </group>
      )}
    </group>
  );
}
