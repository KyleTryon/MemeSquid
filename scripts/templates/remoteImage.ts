const MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export type FetchImageResource = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface DownloadRemoteImageOptions {
  allowedHosts?: ReadonlySet<string>;
  fetchResource?: FetchImageResource;
  resource?: string;
  userAgent?: string;
}

export interface DownloadedRemoteImage {
  image: Buffer;
  url: string;
}

export async function downloadRemoteImage(
  rawUrl: string,
  options: DownloadRemoteImageOptions = {},
): Promise<DownloadedRemoteImage> {
  const resource = options.resource ?? 'Remote image';
  const requestedUrl = validateImageUrl(rawUrl, options.allowedHosts, resource, false);
  const fetchResource = options.fetchResource ?? fetch;
  const response = await fetchResource(requestedUrl, {
    headers: {
      accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8',
      'user-agent': options.userAgent ?? 'MemeSquid template image updater',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${resource} returned HTTP ${response.status}.`);

  const resolvedUrl = validateImageUrl(
    response.url || requestedUrl,
    options.allowedHosts,
    resource,
    true,
  );
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const length = Number(contentLength);
    if (!Number.isFinite(length) || length < 0 || length > MAX_REMOTE_IMAGE_BYTES) {
      throw new Error(`${resource} exceeded the 25 MiB download limit.`);
    }
  }

  const contentType = response.headers.get('content-type')?.toLowerCase();
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`${resource} returned an unexpected content type: ${contentType}.`);
  }

  const image = Buffer.from(await response.arrayBuffer());
  if (!image.byteLength || image.byteLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error(`${resource} was empty or exceeded the 25 MiB download limit.`);
  }
  return { image, url: resolvedUrl };
}

function validateImageUrl(
  rawUrl: string,
  allowedHosts: ReadonlySet<string> | undefined,
  resource: string,
  redirected: boolean,
): string {
  const url = new URL(rawUrl.trim());
  if (url.protocol !== 'https:') {
    throw new Error(
      redirected ? `${resource} redirected to a non-HTTPS URL.` : `${resource} URL must use HTTPS.`,
    );
  }
  if (url.username || url.password) {
    throw new Error(`${resource} URL cannot contain credentials.`);
  }
  if (allowedHosts && !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`${resource} ${redirected ? 'redirected to' : 'uses'} an unsupported host.`);
  }
  return url.toString();
}
