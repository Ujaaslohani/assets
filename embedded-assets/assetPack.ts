/**
 * assetPack.ts — index of the embedded vegetation models and their 1024×1024 textures.
 * Everything ships inside the game code: no network requests for assets.
 *  - MODELS:   original .glb files (gzip + base64), textures stripped out and shared
 *  - TEXTURES: the original textures as high-quality WebP data URLs (stored once each)
 */
import { DATA as M1 } from './assetModels1';
import { DATA as M2 } from './assetModels2';
import { DATA as M3 } from './assetModels3';
import { DATA as M4 } from './assetModels4';
import { DATA as M5 } from './assetModels5';
import { DATA as M6 } from './assetModels6';
import { DATA as T1 } from './assetTextures1';
import { DATA as T2 } from './assetTextures2';
import { DATA as T3 } from './assetTextures3';
import { DATA as T4 } from './assetTextures4';

export const MODELS: Record<string, string> = { ...M1, ...M2, ...M3, ...M4, ...M5, ...M6 };
export const TEXTURES: Record<string, string> = { ...T1, ...T2, ...T3, ...T4 };
