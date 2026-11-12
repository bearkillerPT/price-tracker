/** Where the password is reset: a terminal on the machine that runs the app, with the command for how it runs. */
export function ResetPasswordHint() {
  return import.meta.env.DEV ? (
    <>
      Forgot it? In the repo folder, run <code className="font-mono">pnpm reset-password</code>. Products, listings and history are kept.
    </>
  ) : (
    <>
      Forgot it? On the server, run <code className="font-mono">sudo -u price-tracker price-tracker reset-password</code> (the command the
      NixOS service installs; other setups are in the{" "}
      <a className="underline" href="https://github.com/bearkillerPT/price-tracker#forgotten-password" target="_blank" rel="noreferrer noopener">
        README
      </a>
      ). Products, listings and history are kept.
    </>
  );
}
