import { photoUrl } from '@/lib/photos';
import type { CameraPhoto } from '@/types/models';

// On a trail camera's card: how many photos it has, the latest one, and a way in.
export function CameraPhotosInfo({ photos, onOpen }: { photos: CameraPhoto[]; onOpen(): void }) {
  const latest = [...photos].sort((a, b) => b.takenAt.localeCompare(a.takenAt))[0];
  const animals = photos.filter((p) => p.status === 'animal').length;
  const fresh = photos.filter((p) => p.status === 'new').length;
  return (
    <section className="stand-history camera-info">
      <h3>Photos</h3>
      {photos.length === 0 ? (
        <p className="muted">No photos from this camera yet.</p>
      ) : (
        <>
          {latest && window.hub && <img className="camera-latest" src={photoUrl(latest.file, true)} alt="Latest photo" />}
          <p className="muted">
            {photos.length.toLocaleString()} photos · {animals.toLocaleString()} with animals{fresh ? ` · ${fresh.toLocaleString()} to review` : ''}
            {latest && ` · latest ${new Date(latest.takenAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
          </p>
        </>
      )}
      <button onClick={onOpen}>Open photos</button>
    </section>
  );
}
