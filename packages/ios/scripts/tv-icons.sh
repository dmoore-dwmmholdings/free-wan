#!/bin/bash
# Builds the Apple TV app's icons and top-shelf images from the iPhone icon: the F on its purple,
# as a two-layer image stack for the tvOS parallax tilt. Run from packages/ios after changing it.
set -e
SRC=App/Assets.xcassets/AppIcon.appiconset/icon.png
A=TV/Assets.xcassets
B="$A/App Icon & Top Shelf Image.brandassets"
rm -rf "$A"; mkdir -p "$B"
json() { printf '%s\n' "$2" > "$1/Contents.json"; }
info='"info":{"author":"xcode","version":1}'
json "$A" "{$info}"
img() { # out w h kind
  local out=$1 w=$2 h=$3 kind=$4 s t; t=$(mktemp -d)
  case $kind in
    front) s=$(( w > h ? w : h )); sips -s format png -z $s $s "$SRC" --out "$t/a.png" >/dev/null; sips -c $h $w "$t/a.png" --out "$out" >/dev/null ;;
    back) sips -s format png -c 100 100 --cropOffset 0 0 "$SRC" --out "$t/a.png" >/dev/null; sips -z $h $w "$t/a.png" --out "$out" >/dev/null ;;
    banner) s=$(( h * 13 / 10 )); sips -s format png -z $s $s "$SRC" --out "$t/a.png" >/dev/null; sips -c $h $s "$t/a.png" --out "$t/b.png" >/dev/null; sips -p $h $w --padColor 6E4CFF "$t/b.png" --out "$out" >/dev/null ;;
  esac
  rm -rf "$t"
}
stack() { # name w h scales...
  local name=$1 w=$2 h=$3 layer kind L entries sc f; shift 3; S="$B/$name.imagestack"; mkdir -p "$S"
  json "$S" "{$info,\"layers\":[{\"filename\":\"Front.imagestacklayer\"},{\"filename\":\"Back.imagestacklayer\"}]}"
  for layer in Front Back; do
    kind=$(echo $layer | tr A-Z a-z)
    L="$S/$layer.imagestacklayer/Content.imageset"; mkdir -p "$L"; json "$S/$layer.imagestacklayer" "{$info}"
    entries=""
    for sc in "$@"; do f="$kind@${sc}x.png"; img "$L/$f" $((w*sc)) $((h*sc)) $kind; entries="$entries{\"idiom\":\"tv\",\"filename\":\"$f\",\"scale\":\"${sc}x\"},"; done
    json "$L" "{\"images\":[${entries%,}],$info}"
  done
}
banner() { # name w h
  S="$B/$1.imageset"; mkdir -p "$S"
  img "$S/b@1x.png" $2 $3 banner; img "$S/b@2x.png" $(($2*2)) $(($3*2)) banner
  json "$S" "{\"images\":[{\"idiom\":\"tv\",\"filename\":\"b@1x.png\",\"scale\":\"1x\"},{\"idiom\":\"tv\",\"filename\":\"b@2x.png\",\"scale\":\"2x\"}],$info}"
}
stack "App Icon" 400 240 1 2
stack "App Icon - App Store" 1280 768 1
banner "Top Shelf Image" 1920 720
banner "Top Shelf Image Wide" 2320 720
json "$B" "{\"assets\":[
 {\"filename\":\"App Icon - App Store.imagestack\",\"idiom\":\"tv\",\"role\":\"primary-app-icon\",\"size\":\"1280x768\"},
 {\"filename\":\"App Icon.imagestack\",\"idiom\":\"tv\",\"role\":\"primary-app-icon\",\"size\":\"400x240\"},
 {\"filename\":\"Top Shelf Image Wide.imageset\",\"idiom\":\"tv\",\"role\":\"top-shelf-image-wide\",\"size\":\"2320x720\"},
 {\"filename\":\"Top Shelf Image.imageset\",\"idiom\":\"tv\",\"role\":\"top-shelf-image\",\"size\":\"1920x720\"}],$info}"
