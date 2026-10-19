$ErrorActionPreference = 'Stop'
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
$rustup = Join-Path $env:USERPROFILE '.cargo\bin\rustup.exe'
if (-not (Test-Path $cargo)) { throw 'Rust is not installed. Install rustup first.' }
& $rustup target add wasm32-unknown-unknown
if ($LASTEXITCODE -ne 0) { throw 'Failed to install wasm target.' }
& $cargo build --manifest-path rust-fit/Cargo.toml --target wasm32-unknown-unknown --release
if ($LASTEXITCODE -ne 0) { throw 'Rust build failed.' }
New-Item -ItemType Directory -Force public | Out-Null
Copy-Item rust-fit/target/wasm32-unknown-unknown/release/closet_fit.wasm public/fit.wasm -Force
