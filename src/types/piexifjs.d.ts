// The parts of piexifjs (JPEG metadata read/write) the hub uses. It works on
// "binary strings": one character per byte.
declare module 'piexifjs' {
  type IfdData = Record<number, unknown>;
  export interface ExifData {
    '0th'?: IfdData;
    Exif?: IfdData;
    GPS?: IfdData;
    Interop?: IfdData;
    '1st'?: IfdData;
    thumbnail?: string | null;
  }
  export function load(binary: string): ExifData;
  export function dump(exif: ExifData): string;
  export function insert(exifBytes: string, binary: string): string;
  export const ImageIFD: Record<string, number>;
  export const ExifIFD: Record<string, number>;
  export const GPSIFD: Record<string, number>;
  export const GPSHelper: { degToDmsRational(degrees: number): [number, number][] };
  const piexif: {
    load: typeof load;
    dump: typeof dump;
    insert: typeof insert;
    ImageIFD: typeof ImageIFD;
    ExifIFD: typeof ExifIFD;
    GPSIFD: typeof GPSIFD;
    GPSHelper: typeof GPSHelper;
  };
  export default piexif;
}
