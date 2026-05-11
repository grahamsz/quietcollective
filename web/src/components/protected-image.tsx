type ProtectedImageProps = {
  src: string;
  alt?: string;
};

/** Renders permission-gated media inside Preact work and gallery components. */
export function ProtectedImage({ src, alt = "" }: ProtectedImageProps) {
  return (
    <>
      <img src={src} alt={alt} draggable={false} loading="lazy" decoding="async" data-protected-image />
      <span class="image-shield" data-media-protect aria-hidden="true" />
    </>
  );
}
