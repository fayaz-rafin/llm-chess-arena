"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const BOARD_SIZE = 8;
const SQUARE_SIZE = 1;
const BOARD_OFFSET = (BOARD_SIZE - 1) / 2;

export default function ArenaBackground() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const requestRef = useRef<number | null>(null);
  const angleRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e111a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(6, 7.5, 6);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.7);
    directionalLight.position.set(10, 15, 10);
    scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x4ecdc4, 0.8, 100);
    pointLight.position.set(0, 8, 0);
    scene.add(pointLight);

    for (let row = 0; row < BOARD_SIZE; row += 1) {
      for (let col = 0; col < BOARD_SIZE; col += 1) {
        const isLight = (row + col) % 2 === 0;
        const geometry = new THREE.BoxGeometry(SQUARE_SIZE, 0.2, SQUARE_SIZE);
        const material = new THREE.MeshStandardMaterial({
          color: isLight ? 0xf1f0ea : 0x6c7a55,
          roughness: 0.85,
          metalness: 0.05,
        });
        const square = new THREE.Mesh(geometry, material);
        square.position.set(
          col * SQUARE_SIZE - BOARD_OFFSET,
          -0.1,
          row * SQUARE_SIZE - BOARD_OFFSET
        );
        scene.add(square);
      }
    }

    const animate = () => {
      if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;
      angleRef.current += 0.0015;
      const radius = 9.5;
      cameraRef.current.position.x = Math.sin(angleRef.current) * radius;
      cameraRef.current.position.z = Math.cos(angleRef.current) * radius;
      cameraRef.current.lookAt(0, 0, 0);

      rendererRef.current.render(sceneRef.current, cameraRef.current);
      requestRef.current = requestAnimationFrame(animate);
    };

    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);
    requestRef.current = requestAnimationFrame(animate);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      window.removeEventListener("resize", handleResize);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (rendererRef.current.domElement.parentNode) {
          rendererRef.current.domElement.parentNode.removeChild(
            rendererRef.current.domElement
          );
        }
      }
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}
