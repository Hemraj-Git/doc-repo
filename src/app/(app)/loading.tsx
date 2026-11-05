// Shown the moment a link is clicked, while the server renders the page. It also gives
// Next.js something to prefetch for these dynamic pages, so navigation feels instant.
// Dynamic segments ([id], [folderId], …) have their own loading.tsx: a boundary only shows
// again when the segment directly below it changes, so moving from one folder or document
// to the next would otherwise keep the old page on screen with no sign of progress.
export { PageSkeleton as default } from "@/components/page-skeleton"
