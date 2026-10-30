# Zangetsu — Complete App Overview

> A free, open-source media player for anime, movies, TV, manga, and light novels.

**Official website:** https://zangetsu.online/  
**Official user guide:** https://zangetsu.online/guide/

This document summarizes the app information published on Zangetsu's official website and guide. It describes the product and its capabilities only. It intentionally excludes community source-repository names, repository URLs, and repository recommendations.

## 1. What is Zangetsu?

Zangetsu is a media player built around user-selected sources. It brings anime, movies, and TV playback together with reading support for manga and light novels. It is free to use, open source, and designed for both touch-screen phones and large-screen Android TV devices.

The app is not a content library or a streaming service. A fresh installation deliberately starts without sources. Users add and manage compatible sources themselves, and the app plays content returned by those independently operated sources.

Zangetsu is not affiliated with any streaming service and does not host, bundle, upload, or distribute the media played through the app.

## 2. Main features

### Media and reading

- Watch anime, movies, and television series through compatible sources.
- Read manga and light novels through their respective source integrations.
- Keep watching and reading progress in the app.
- Switch between sources to compare availability for a title.

### High-quality video player

- Playback powered by the mpv engine.
- Support for playback up to 4K and HDR when the source and device provide it.
- Audio boost and precise seeking.
- Playback speed controls.
- Subtitle selection and styling.
- Quality selection when a source exposes multiple resolutions.
- Gesture controls for seeking, brightness, and volume.
- Support for opening playback in an external player.

Actual resolution, HDR, audio tracks, subtitles, and playback controls depend on the stream, source, device, and player capabilities.

### Offline downloads

- Save episodes and movies to device storage for offline viewing.
- Download individual episodes or use batch download actions where available.
- Streams delivered in multiple segments are combined into a single playable file.
- Choose the storage location for downloads.
- Downloaded videos behave like normal media files, including seeking.

Download availability depends on whether the selected source provides downloadable media.

### Automatic subtitles

Zangetsu can fetch subtitles automatically and lets users customize subtitle appearance, including font, size, and colour. Available subtitle tracks depend on the selected source and stream.

### Watch Party

Watch Party synchronizes playback with friends and provides real-time chat so participants can watch together.

### Progress tracking and scrobbling

When connected, Zangetsu can automatically update viewing progress with supported services:

- AniList
- MyAnimeList
- Simkl
- MangaBaka

These integrations are optional. Users control which accounts they connect. Incognito mode pauses watch history, external scrobbling, and Discord presence while it is enabled.

### No ads and optional account

- The app is free to use and does not show advertisements.
- An account is not required to watch or use the app's basic playback features.
- Signing in is optional and can be used to synchronize a personal list across devices.
- The official guide describes the project as open source under GPL-3.0 and states that it does not use advertising or analytics.

## 3. Supported devices and platforms

### Android phones and tablets

The website lists Android 5.0 and newer as supported. The phone interface is designed around touch controls and provides a familiar streaming-app layout with a hero carousel, gestures, and quick access to content.

### Android TV

Zangetsu also supports Android TV devices, TV boxes, and sticks. The interface adapts for remote control rather than requiring touch input.

The TV experience includes:

- A navigation rail and focus highlights.
- Directional-pad navigation.
- Remote-based selection and back navigation.
- A quick menu opened by holding the OK/select button on a poster.
- A player designed to be operated using a remote.

The official guide recommends the TV or universal build for many Android TV boxes because some devices still use 32-bit architectures.

### APK architectures

The website and guide describe these Android package choices:

| Build | Intended device |
|:--|:--|
| `arm64-v8a` | Most modern Android phones and many recent TV devices. Usually the right starting point. |
| `armeabi-v7a` | Older 32-bit Android phones and TV boxes. |
| `universal` | Broad device compatibility. Larger file size, but a useful fallback when the device architecture is uncertain. |
| TV build | Android TV boxes and sticks. Choose this rather than assuming the arm64 phone build will work. |

An APK that fails to install or closes immediately may be built for the wrong processor architecture. The universal build is the recommended fallback when the correct architecture is uncertain.

### iOS

The official guide describes an iOS beta distributed through TestFlight. It has an important platform limitation: iOS does not support Android-style plugin loading for CloudStream or Aniyomi/Mihon extensions.

The iOS beta therefore uses Zangetsu's own JavaScript sources and retains the app's player, downloads, trackers, and personal list features, but it does not provide the full Android extension ecosystem.

## 4. Source and extension system

Zangetsu separates the player from the sources that locate media. Sources are independently maintained plugins that know how to search a service and return information or playable links.

A fresh installation starts with no sources by design. Users choose which compatible sources to add and manage. Sources can cover different activities, such as anime, movies, TV, manga, or light novels.

The official guide describes support for these source ecosystems:

| Ecosystem | Format or purpose |
|:--|:--|
| Zangetsu | Native lightweight JavaScript sources. |
| CloudStream | `.cs3` extensions. |
| Aniyomi | Android extension packages, commonly used for anime. |
| Mihon | Android extension packages, commonly used for manga. |
| LNReader | Light-novel plugins. |

CloudStream and Aniyomi/Mihon extension loading are Android-specific. The availability and compatibility of a source depend on its maintainer and the upstream service it uses.

No source is guaranteed to remain available. Websites can change their layout, block requests, move domains, or stop operating, which can cause a source to stop working until it is updated.

## 5. Finding and watching content

### Finding a title

- Use the search control in the bottom navigation bar.
- Results are grouped by source, making it easier to see which sources returned a title.
- Use the source selector at the top of the home screen to change the source being browsed.
- The app separates viewing and reading modes and filters source choices to match the current activity.

### Playing an episode or movie

1. Open a title.
2. Select the episode or movie.
3. Zangetsu starts with the first server that responds.
4. When another server is preferable, open the sources panel in the player and choose it.
5. The selected server is remembered for that title.

The player provides controls for speed, subtitles and subtitle styling, supported quality options, and gestures for seeking, brightness, and volume. Watch progress is saved automatically so the Continue Watching area can resume playback.

### Quality selection

The quality menu reflects the resolutions actually exposed by the current stream. Some sources return separate files for each quality, in which case those choices appear as separate servers in the source panel. When a source does not report quality information, the app does not show a quality selector for that stream.

## 6. Downloads and offline viewing

To save content, use the download control on an episode. Where available, the episode list also provides a batch-download action.

Some streams arrive in multiple pieces. Zangetsu combines those segments into a single playable file so an offline download behaves like a normal video and supports seeking. Downloads appear in the Downloads section, and the destination folder can be changed in settings.

## 7. Using Zangetsu on a TV

Install the TV-compatible build on the Android TV device. Zangetsu detects the TV environment and adapts to a remote-first interface.

Remote controls:

- Arrow keys move focus.
- OK/select opens the focused item.
- Back returns to the previous screen.
- Holding OK on a poster opens its quick menu.

### Connecting accounts without typing

For account connections on a TV:

1. Open **Settings → Connections → Connect**.
2. Choose the QR-based connection flow.
3. If Zangetsu is installed on the phone, scan using that app and approve the connection.
4. Otherwise, scan with the phone camera and complete sign-in in the browser.

The guide describes this flow for connecting the app account and supported tracking services such as AniList, MyAnimeList, and Simkl.

### Casting

Users can cast from a phone to a Chromecast instead of installing the app directly on the TV. Some streams require request headers. In those cases, Zangetsu may serve the stream through the phone, so the phone must remain awake and connected to the same network while casting.

## 8. Updates

The app checks for new releases and can offer updates inside Zangetsu. An optional beta channel can be enabled in settings for pre-release versions.

Users can also install a newer compatible APK over the existing installation. The official guide states that this update method keeps app data.

## 9. Troubleshooting

### The home screen is empty

This is expected on a fresh installation. Zangetsu does not bundle sources. Add compatible sources that match the activity you want to use, such as anime, movies, TV, manga, or light novels.

### Nothing plays or playback buffers indefinitely

The official guide notes that playback failures are often caused by the source rather than the player.

1. Try another source for the same title.
2. Open **Settings → Sources → Source health** to test installed sources.
3. Update sources when an update is available.
4. If a source is behind a Cloudflare browser check, complete the check in the browser view that opens. The result is remembered.
5. If a server stalls, choose another server from the player.
6. Try an external player if playback still fails.

Source health helps identify sources that have stopped responding. Search can prioritize healthy sources and skip sources that recently failed.

### A browser opens during playback

Some websites require a browser-based Cloudflare verification. Complete it once in the browser view. A few sources may also open an advertisement page while resolving a link. The official guide attributes that behaviour to the source, not to Zangetsu itself.

### Playback starts slowly

Streams with many audio-language tracks can take longer to initialize. Keep the app updated, adjust the playback buffer in settings if the network is weak, or try another server or an external player.

### Video quality looks incorrect

Check which resolutions the active stream actually exposes. Some sources return one file per quality and display those files as separate servers rather than options in a quality menu.

### Sign-in on a TV is inconvenient

Use the QR connection flow under **Settings → Connections → Connect** rather than typing credentials with the remote.

## 10. Privacy, responsibility, and project boundaries

Zangetsu is a player for sources chosen by the user. The app is not affiliated with a streaming service and does not host, upload, store, or distribute the media returned by third-party sources.

Keep these distinctions in mind:

- Source operators independently control their sites, services, returned links, and availability.
- Source integrations can stop working when upstream websites change.
- Optional account and tracking connections are user-controlled.
- Incognito mode pauses local watch history, scrobbling, and Discord presence while active.
- A source opening a browser or showing an advertisement page does not mean that page is operated by Zangetsu.
- Users are responsible for deciding which sources to install and for complying with applicable laws and each service's terms.

The official guide identifies the app as open source under the GNU General Public License version 3.0 (GPL-3.0).

## 11. Official information

For current product information and the latest user guidance, refer to:

- [Zangetsu official website](https://zangetsu.online/)
- [Zangetsu user guide](https://zangetsu.online/guide/)

This document summarizes the information published on those official pages. Platform availability, beta status, compatibility, and features may change as the app is updated.
