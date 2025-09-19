# Server-Side Downloads Feature - Changes Summary

## Overview
Added Docker container support with server-side file downloads and enterprise-grade feature control. Files can be saved directly to the host filesystem via Docker volume mounting, with complete feature toggle control for different deployment scenarios.

## New Environment Variables

### Feature Control
- **`ENABLE_SERVER_DOWNLOADS`** - Global feature toggle for server-side downloads (default: `false`)
  - `true`: Shows server download options in UI and enables server-side functionality
  - `false`: Hides server download UI and forces client-only downloads (ZIP/individual files)

### Configuration Variables  
- **`QOBUZ_DOWNLOAD_PATH`** - Server download directory path (default: `/downloads`)
- **`DEFAULT_SERVER_DOWNLOADS`** - User default preference for server downloads (default: `true` when feature enabled)
- **`DEFAULT_OUTPUT_QUALITY`** - Default audio quality (default: `27` - Hi-Res)
- **`DEFAULT_OUTPUT_CODEC`** - Default audio codec (default: `FLAC`)
- **`DEFAULT_BITRATE`** - Default MP3 bitrate when applicable (default: `320`)
- **`DEFAULT_FOLDER_NAME`** - Server folder naming pattern (default: `{artists} - {name}`)
- **`DEFAULT_TRACK_NAME`** - Track file naming pattern (default: `{artists} - {name}`)
- **`DEFAULT_ZIP_NAME`** - ZIP file naming pattern for browser downloads (default: `{artists} - {name}`)

## New Files Added

### API Endpoints
- **`app/api/save-to-server/route.ts`** - New API endpoint for saving processed audio files to the server filesystem
- **`app/api/server-config/route.ts`** - New API endpoint for providing server-wide default settings and feature toggles

### Docker Configuration  
- **`docker-compose.override.example.yml`** - Example override file for customizing Docker compose settings
- **`downloads/`** - Directory created for storing downloaded files (Docker volume mount target)

## Modified Files

### Core Download Logic
- **`lib/download-job.tsx`**
  - Added `isServerDownloadsEnabled()` helper function to check global feature toggle
  - Modified all server download logic to check both global `ENABLE_SERVER_DOWNLOADS` and user preference
  - Updated `proceedDownload()` function to conditionally save files to server when both flags are true
  - Added success toast messages for completed server downloads (both single tracks and albums)
  - Updated album downloads to save individual files to organized folders instead of creating ZIP archives
  - Added proper FormData handling for server API calls
  - Made `onloadedmetadata` function async to support server uploads

### Settings & Configuration
- **`lib/settings-provider.tsx`**
  - Added `enableServerDownloads` context variable from server config
  - Added server-side download configuration support with global feature toggle
  - Added server config API integration for default settings
  - Updated settings provider to expose global feature flag to components

### UI Components
- **`components/ui/settings-form.tsx`**
  - Added conditional rendering of server-side downloads section based on `enableServerDownloads` flag
  - Added toggle for server-side downloads setting in UI (only visible when globally enabled)
  - Updated settings form to include new server download options with folder naming support

- **`components/download-album-button.tsx`**
  - Updated to check both global `enableServerDownloads` flag and user preference
  - Shows dropdown with ZIP/No-ZIP options when server downloads are disabled or not preferred
  - Shows simple button when server downloads are globally enabled AND user has enabled them
  - Maintained full compatibility with existing browser download functionality

- **`components/release-card.tsx`** 
  - Updated download button integration
  - Maintained existing UI/UX behavior

### Utilities & Helpers
- **`lib/utils.ts`**
  - Added `cleanFolderPath()` function to preserve "/" characters for folder hierarchy support
  - Maintains existing `cleanFileName()` for individual file name sanitization  
  - Supports folder structure like `{artists}/{name}` for nested organization

### Docker & Infrastructure
- **`Dockerfile`**
  - Added `/downloads` directory creation with proper permissions
  - Ensured Docker container has necessary filesystem access

- **`docker-compose.yml`**
  - Added volume mounting for `./downloads` directory  
  - Configured persistent storage for downloaded files
  - Set up proper container networking

### Development Configuration
- **`.env.example`**
  - Added comprehensive documentation for all new environment variables
  - Included server-side download feature toggle documentation  
  - Added examples and default values for all configuration options including new `DEFAULT_ZIP_NAME`

- **`README.md`**
  - Updated with Docker setup instructions
  - Added server-side download feature documentation
  - Included volume mounting and file organization details

- **`eslint.config.mjs`**
  - Updated linting configuration for new TypeScript patterns and API routes

### API Integration  
- **`app/api/download-music/route.ts`**
  - Added debug logging to track download API usage
  - Maintained existing Qobuz integration functionality

## Key Features Implemented

### 1. Enterprise Feature Control
- **Global Feature Toggle**: `ENABLE_SERVER_DOWNLOADS` environment variable controls entire feature availability
- **Deployment Flexibility**: Client-only deployments (feature disabled) vs full-featured deployments (feature enabled)
- **UI Conditional Rendering**: Server download options only appear when globally enabled
- **Backend Logic Protection**: Server downloads completely disabled when global flag is false, regardless of user settings

### 2. Server-Side File Storage (when enabled)
- Files are processed client-side with FFmpeg WebAssembly
- Processed files are uploaded to server via `/api/save-to-server` endpoint
- Files saved to configurable directory with proper organization
- Support for folder hierarchy patterns like `{artists}/{album}` for nested structure

### 3. Enhanced Folder Organization
- **Configurable Patterns**: Use variables like `{artists}`, `{name}`, `{year}` for flexible naming
- **Hierarchy Support**: Create nested folders with `/` separator (e.g., `{artists}/{name}`)
- **Single Tracks**: Saved directly to configured download path
- **Albums**: Saved to organized album folders with track numbering
- **Cover Art**: Automatically included in album folders

### 4. Client Download Options (when server downloads disabled)
- **ZIP Archive**: Downloads entire album as single ZIP file to browser
- **No ZIP Archive**: Downloads each track individually to browser (file-by-file)
- **Dropdown Interface**: Clean UI showing both download options
- **Full Compatibility**: Maintains all existing browser download functionality

### 5. Docker Volume Integration
- Host directory mounted to container download path
- Persistent storage across container restarts
- Configurable mount paths via `QOBUZ_DOWNLOAD_PATH`
- Direct filesystem access for downloaded files

## Technical Implementation

### Feature Control Flow
1. **Server Config Check**: `ENABLE_SERVER_DOWNLOADS` environment variable determines feature availability
2. **UI Rendering**: Settings form conditionally shows server download options based on global flag
3. **Download Logic**: Both global flag AND user preference must be true for server downloads
4. **Fallback Behavior**: When disabled, always uses browser downloads with ZIP/No-ZIP options

### Download Flow
1. User initiates download (track/album)
2. System checks global `ENABLE_SERVER_DOWNLOADS` flag
3. Client processes audio with FFmpeg WebAssembly
4. **If server downloads enabled AND user prefers server downloads**:
   - File uploaded to `/api/save-to-server` with configurable path
   - Server saves to organized directory structure using folder patterns
5. **If server downloads disabled OR user prefers client downloads**:
   - Shows dropdown with ZIP Archive / No ZIP Archive options
   - Original browser download behavior maintained

### File Organization
- **Configurable Patterns**: Use `DEFAULT_FOLDER_NAME` and `DEFAULT_TRACK_NAME` with variables
- **Single Track**: `{DOWNLOAD_PATH}/{track_pattern}.{extension}`
- **Album with Flat Structure**: `{DOWNLOAD_PATH}/{album_pattern}/{track_number} {track_pattern}.{extension}`  
- **Album with Hierarchy**: `{DOWNLOAD_PATH}/{artists}/{album_name}/{track_number} {track_pattern}.{extension}`
- **Cover Art**: Automatically included in album folders as `cover.jpg`
- **Path Sanitization**: Folder paths preserve `/` for hierarchy, file names sanitize all invalid characters

### Error Handling
- Comprehensive error logging in server API
- Graceful fallback behavior
- User feedback via toast notifications

## Environment Setup

### Feature Toggle Configuration
```bash
# Enable server-side downloads feature (default: false)
ENABLE_SERVER_DOWNLOADS=true

# Configure download path (default: /downloads) 
QOBUZ_DOWNLOAD_PATH=/path/to/downloads

# Set server-wide defaults
DEFAULT_SERVER_DOWNLOADS=true
DEFAULT_OUTPUT_QUALITY=27    # Hi-Res 24-bit
DEFAULT_OUTPUT_CODEC=FLAC
DEFAULT_BITRATE=320
DEFAULT_FOLDER_NAME={artists} - {name}
DEFAULT_TRACK_NAME={artists} - {name}
DEFAULT_ZIP_NAME={artists} - {name}
```

### Docker Configuration
```yaml
volumes:
  - "./downloads:/downloads"  # or custom path from QOBUZ_DOWNLOAD_PATH
environment:
  - ENABLE_SERVER_DOWNLOADS=true
  - QOBUZ_DOWNLOAD_PATH=/downloads
```

### Settings Integration
- Server config API provides default settings and feature flags
- Client-side settings merged with server defaults
- Global `ENABLE_SERVER_DOWNLOADS` overrides all user preferences
- UI conditionally renders based on feature availability

## Quality Assurance

### Verified Functionality
✅ Global feature toggle (`ENABLE_SERVER_DOWNLOADS`) working correctly
✅ Conditional UI rendering based on feature availability
✅ Server downloads only work when both global flag and user preference are enabled
✅ Client download dropdown (ZIP/No-ZIP) appears when server downloads disabled
✅ Single track downloads to server with configurable paths
✅ Album downloads with folder organization and hierarchy support
✅ Docker volume mounting and persistence with custom paths
✅ Original browser download compatibility maintained
✅ Settings UI integration with conditional visibility
✅ Success toast notifications for completed server downloads
✅ Comprehensive error handling and logging  
✅ Environment variable configuration and defaults including ZIP naming

### Deployment Scenarios
- **Client-Only Deployment**: `ENABLE_SERVER_DOWNLOADS=false` - No server UI, browser downloads only
- **Full-Featured Deployment**: `ENABLE_SERVER_DOWNLOADS=true` - All features available
- **Mixed Usage**: Users can toggle between server and client downloads within enabled deployments

### File Format Support
- FLAC (lossless, default)
- MP3 (320kbps default, configurable)
- WAV, ALAC, AAC, OPUS
- All existing codec support maintained with server-wide defaults

## Deployment Guide

### Client-Only Setup (Default)
```bash
# .env
ENABLE_SERVER_DOWNLOADS=false  # or omit entirely
```
- Server download options hidden from UI
- Download button shows ZIP/No-ZIP dropdown
- All downloads go to browser

### Server Downloads Setup  
```bash
# .env
ENABLE_SERVER_DOWNLOADS=true
QOBUZ_DOWNLOAD_PATH=/your/download/path
DEFAULT_FOLDER_NAME={artists}/{name}  # for hierarchy
```
- Server download options visible in settings
- Users can choose between server and browser downloads
- Files saved to configured server path

## Notes
- **Security by Design**: Server features disabled by default
- **Enterprise Ready**: Feature toggles for different deployment needs  
- **Full Backwards Compatibility**: Existing functionality preserved
- **Docker Optional**: App works with or without containers
- **Flexible Organization**: Support for flat and hierarchical folder structures