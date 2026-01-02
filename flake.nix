{
  description = "Bun development environment for justjake.me";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            git
            bun
          ];

          shellHook = ''
            echo "Bun development environment loaded"
            echo "Bun version: $(bun --version)"
            exec zsh
          '';
        };
      }
    );
}
