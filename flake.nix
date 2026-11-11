{
  description = "Price tracker: follows product prices on EU web shops and notifies on changes";

  # Locked to the same nixpkgs revision as raspberryConfs, so dev and the Pi run the same Node and Chromium
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 pkgs.pnpm pkgs.postgresql_17 ];
          # Playwright's downloaded browsers don't run on NixOS; use nixpkgs' build, whose version
          # playwright-core in apps/api is pinned to (1.59.1 in nixos-26.05)
          PLAYWRIGHT_BROWSERS_PATH = pkgs.playwright-driver.browsers-chromium;
        };
      });
    };
}
