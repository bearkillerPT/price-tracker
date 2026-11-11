/**
 * Names the bot protection that answered instead of the page, or null. Only challenges and blocks count:
 * many shops load these services' scripts on normal pages too (Fnac loads DataDome's), so a script
 * mention alone isn't a block.
 */
export function detectProtection(status: number, headers: Record<string, string>, body: string): string | null {
  const head = body.slice(0, 20_000);
  if (headers['cf-mitigated'] === 'challenge' || /<title>Just a moment|cf_chl_opt|\/cdn-cgi\/challenge-platform\/h\/[a-z]\/orchestrate/i.test(head)) {
    return 'Cloudflare challenge';
  }
  if (status >= 400 && (/captcha-delivery\.com/i.test(head) || headers['x-datadome'] !== undefined || headers['x-dd-b'] !== undefined)) {
    return 'DataDome challenge';
  }
  if (status >= 400 && /px-captcha|_pxCaptcha|perimeterx/i.test(head)) return 'PerimeterX challenge';
  if (/_Incapsula_Resource|Incapsula incident ID/i.test(head)) return 'Imperva challenge';
  if (status === 403 && /Access Denied/i.test(head) && /errors\.edgesuite\.net|Reference #\d/i.test(head)) return 'Akamai block';
  return null;
}
