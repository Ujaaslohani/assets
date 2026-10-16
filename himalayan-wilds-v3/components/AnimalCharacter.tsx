import {useFrame} from '@react-three/fiber';
import {forwardRef, useRef} from 'react';
import * as THREE from 'three';

/** Stable defaults: a fresh array each render would fight imperative updates. */
const DEFAULT_POSITION: [number, number, number] = [0, 0, 0];
const DEFAULT_ROTATION: [number, number, number] = [0, 0, 0];

/**
 * Props for the ProceduralAnimal component.
 */
export interface ProceduralAnimalProps {
  type?: 'dog' | 'cat' | 'horse' | 't-rex' | 'chicken';
  color?: string;
  state?: 'idle' | 'walk' | 'run';
  size?: number;
  /**
   * Static placement only. For an animal that moves every frame, leave this
   * unset and drive the transform through the forwarded ref (or a parent
   * group) inside useFrame — see PlayerRig in Game.tsx. Feeding a per-frame
   * position in here does nothing: React skips the update and the animal
   * stays where it spawned.
   */
  position?: [number, number, number];
  rotation?: [number, number, number];
  /**
   * Whether the animal casts shadows from the scene's sun light. Defaults to
   * true; turn it off for large crowds to save shadow-map draw calls.
   */
  castShadow?: boolean;
}

/**
 * Procedural geometric animal character with animations.
 *
 * The ref is forwarded to the root group so callers can move the animal
 * imperatively:
 *   const ref = useRef<THREE.Group>(null);
 *   useFrame(() => void ref.current?.position.set(x, y, z));
 *   <AnimalCharacter ref={ref} type="dog" state="run" />
 *
 * The model faces -Z, so a heading computed with Math.atan2(dx, dz) needs a
 * + Math.PI when it is applied to rotation.y.
 */
export const AnimalCharacter = forwardRef<THREE.Group, ProceduralAnimalProps>(
  function AnimalCharacter(
    {
      type = 'dog',
      color = '#8b5a2b',
      state = 'idle',
      size = 1,
      position = DEFAULT_POSITION,
      rotation = DEFAULT_ROTATION,
      castShadow = true,
    }: ProceduralAnimalProps,
    ref,
  ) {
    const frontLeftLeg = useRef<THREE.Group>(null);
    const frontRightLeg = useRef<THREE.Group>(null);
    const backLeftLeg = useRef<THREE.Group>(null);
    const backRightLeg = useRef<THREE.Group>(null);

    // Simplified animal scales based on type
    const isBiped = type === 't-rex' || type === 'chicken';
    const bodyArgs: [number, number, number] = isBiped
      ? [0.4, 0.6, 0.5]
      : [0.4, 0.4, 0.8];
    const legLength = type === 'horse' ? 0.8 : type === 'dog' ? 0.4 : 0.3;

    useFrame(({clock}) => {
      const t = clock.getElapsedTime();
      const speed = state === 'run' ? 18 : 10;
      const intensity = state === 'idle' ? 0 : state === 'run' ? 0.6 : 0.3;

      // Back legs exist for every animal. Front legs are only mounted for
      // quadrupeds, so they must not gate the biped animation.
      const backLeft = backLeftLeg.current;
      const backRight = backRightLeg.current;
      if (!backLeft || !backRight) return;

      const swing = Math.sin(t * speed) * intensity;
      if (isBiped) {
        backLeft.rotation.x = swing;
        backRight.rotation.x = -swing;
      } else {
        // Quadruped trot: diagonal pairs move together.
        backRight.rotation.x = swing;
        backLeft.rotation.x = -swing;
        if (frontLeftLeg.current) frontLeftLeg.current.rotation.x = swing;
        if (frontRightLeg.current) frontRightLeg.current.rotation.x = -swing;
      }
    });

    return (
      <group
        ref={ref}
        position={position}
        rotation={rotation}
        scale={[size, size, size]}>
        {/* Body */}
        <mesh
          position={[0, legLength + bodyArgs[1] / 2, 0]}
          castShadow={castShadow}>
          <boxGeometry args={bodyArgs} />
          <meshStandardMaterial color={color} />
        </mesh>

        {/* Head */}
        <mesh
          position={[0, legLength + bodyArgs[1], isBiped ? -0.2 : -0.5]}
          castShadow={castShadow}>
          <boxGeometry args={[0.3, 0.3, 0.4]} />
          <meshStandardMaterial color={color} />
        </mesh>

        {/* Legs */}
        {!isBiped && (
          <>
            <group ref={frontLeftLeg} position={[-0.15, legLength, -0.3]}>
              <Leg length={legLength} color={color} castShadow={castShadow} />
            </group>
            <group ref={frontRightLeg} position={[0.15, legLength, -0.3]}>
              <Leg length={legLength} color={color} castShadow={castShadow} />
            </group>
          </>
        )}
        <group
          ref={backLeftLeg}
          position={[-0.15, legLength, isBiped ? 0 : 0.3]}>
          <Leg length={legLength} color={color} castShadow={castShadow} />
        </group>
        <group
          ref={backRightLeg}
          position={[0.15, legLength, isBiped ? 0 : 0.3]}>
          <Leg length={legLength} color={color} castShadow={castShadow} />
        </group>
      </group>
    );
  },
);

function Leg({
  length,
  color,
  castShadow,
}: {
  length: number;
  color: string;
  castShadow: boolean;
}) {
  return (
    <group>
      <mesh position={[0, -length / 2, 0]} castShadow={castShadow}>
        <cylinderGeometry args={[0.06, 0.04, length]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  );
}
