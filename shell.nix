# shell.nix
{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    git
    bun
  ];

  shellHook = ''
    echo "Bun development environment loaded"
    echo "Bun version: $(bun --version)"
    exec zsh
  '';
}
