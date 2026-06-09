import ShareGalleryClient from "./ShareGalleryClient";

export default async function SharedFolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShareGalleryClient shareId={id} />;
}
