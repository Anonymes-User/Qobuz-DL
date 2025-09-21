import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'
import axios from 'axios'
import { formatCustomTitle, cleanFileName, cleanFolderPath } from '@/lib/utils'
import { SettingsProps } from '@/lib/settings-provider'
import { QobuzAlbum, QobuzTrack, FetchedQobuzAlbum, getDownloadURL, getAlbumInfo, formatArtists, formatTitle, getAlbum, getFullResImageUrl } from '@/lib/qobuz-dl'

interface ServerDownloadPayload {
  track?: QobuzTrack
  album_id?: string
  settings: SettingsProps
  formattedTitle?: string
}

export async function POST(request: NextRequest) {
  try {
    const payload: ServerDownloadPayload = await request.json()
    const { track, album_id, settings, formattedTitle } = payload

    console.log('Server download payload:', { track: !!track, album_id, formattedTitle })

    const downloadPath = settings.serverDownloadPath || 'downloads'
    const fullPath = path.resolve(downloadPath)

    // Ensure directory exists
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true })
      console.log('Created download path:', fullPath)
    }

    if (track) {
      console.log('Processing track:', track.title)
      try {
        await processTrack(track, settings, formattedTitle || 'Unknown', fullPath)
        console.log('Track processed')
      } catch (error) {
        console.error('Error processing track:', track.id, error)
        throw error
      }
    } else if (album_id) {
      console.log('Fetching album data for id:', album_id)
      const albumData = await getAlbumInfo(album_id)
      console.log('Fetched album:', albumData.title, 'tracks:', albumData.tracks.items.length)
      const folderTitle = formatCustomTitle(settings.folderName, albumData)
      console.log('Formatted folder title:', folderTitle)
      const albumFolder = path.join(fullPath, cleanFolderPath(folderTitle))
      if (!fs.existsSync(albumFolder)) {
        fs.mkdirSync(albumFolder, { recursive: true })
        console.log('Created album folder:', albumFolder)
      }
      for (const track of albumData.tracks.items) {
        if (track && track.streamable) {
          try {
            console.log('Processing album track:', track.title)
            track.album = albumData // Ensure track has album data for formatting
            const trackTitle = formatCustomTitle(settings.trackName, track)
            await processTrack(track, settings, trackTitle, albumFolder, albumData)
          } catch (error) {
            console.error('Error processing track:', track.id, error)
          }
        }
      }
      console.log('Album processed')
    }

    console.log('Server download completed successfully')
    return NextResponse.json({ success: true, message: 'Download completed' })
  } catch (error: any) {
    console.error('Server download error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}

async function processTrack(track: QobuzTrack, settings: SettingsProps, title: string, outputDir: string, albumData?: FetchedQobuzAlbum) {
  try {
    if (!title || title.trim() === '') {
      title = `Track ${track.track_number || 'Unknown'}`
    }
    console.log('Processing track:', title, 'id:', track.id)

    let finalOutputDir = outputDir
    if (!albumData) {
      const folderPath = formatCustomTitle(settings.folderName, track)
      finalOutputDir = path.join(outputDir, cleanFolderPath(folderPath))
      if (!fs.existsSync(finalOutputDir)) {
        fs.mkdirSync(finalOutputDir, { recursive: true })
        console.log('Created folder for single track:', finalOutputDir)
      }
    }

    // Get download URL
    const trackUrl = await getDownloadURL(track.id, settings.outputQuality)
    console.log('Got URL, downloading...')

    // Download audio
    const audioResponse = await axios.get(trackUrl, { responseType: 'arraybuffer' })
    const audioBuffer = Buffer.from(audioResponse.data)
    console.log('Downloaded, size:', audioBuffer.length)

    // Save raw audio
    const rawPath = path.join(os.tmpdir(), `raw_${track.id}.flac`)
    fs.writeFileSync(rawPath, audioBuffer)
    console.log('Saved raw file to temp:', rawPath)

    // Apply FFmpeg processing if needed
    if (
      settings.applyMetadata ||
      !(
        (settings.outputQuality === '27' && settings.outputCodec === 'FLAC') ||
        (settings.bitrate === 320 && settings.outputCodec === 'MP3')
      )
    ) {
      console.log('Applying FFmpeg...')
      await applyFFmpeg(rawPath, settings, finalOutputDir, title, track, albumData)
      console.log('FFmpeg applied')
    } else {
      console.log('No FFmpeg needed')
    }
  } catch (error) {
    console.error('Error processing track:', error)
    throw error
  }
}

async function applyFFmpeg(inputPath: string, settings: SettingsProps, outputDir: string, title: string, track: QobuzTrack, albumData?: FetchedQobuzAlbum) {
  const outputPath = path.join(outputDir, `${cleanFileName(title)}.${settings.outputCodec.toLowerCase()}`)

  const skipRencode =
    (settings.outputQuality !== '5' && settings.outputCodec === 'FLAC') ||
    (settings.outputQuality === '5' && settings.outputCodec === 'MP3' && settings.bitrate === 320)

  if (skipRencode && !settings.applyMetadata) {
    // No processing needed, just move the file
    fs.renameSync(inputPath, outputPath)
    console.log('No processing needed, moved file to:', outputPath)
    return
  }

  let currentInput = inputPath
  const temp1 = path.join(outputDir, 'temp1.' + settings.outputCodec.toLowerCase())
  const temp2 = path.join(outputDir, 'temp2.' + settings.outputCodec.toLowerCase())

  // Step 1: Re-encode if necessary
  if (!skipRencode) {
    const reencodeArgs = ['-y', '-i', inputPath]
    reencodeArgs.push('-c:a')
    if (settings.outputCodec === 'FLAC') reencodeArgs.push('flac')
    else if (settings.outputCodec === 'WAV') reencodeArgs.push('pcm_s16le')
    else if (settings.outputCodec === 'ALAC') reencodeArgs.push('alac')
    else if (settings.outputCodec === 'MP3') reencodeArgs.push('libmp3lame')
    else if (settings.outputCodec === 'AAC') reencodeArgs.push('aac')
    else if (settings.outputCodec === 'OPUS') reencodeArgs.push('libopus')

    if (settings.bitrate && settings.outputCodec !== 'FLAC' && settings.outputCodec !== 'WAV' && settings.outputCodec !== 'ALAC') {
      reencodeArgs.push('-b:a', `${settings.bitrate}k`)
    }
    if (settings.outputCodec === 'OPUS') {
      reencodeArgs.push('-vbr', 'on')
    }
    reencodeArgs.push(temp1)

    await runFFmpeg(reencodeArgs)
    currentInput = temp1
  }

  // Step 2: Apply metadata if enabled
  if (settings.applyMetadata) {
    const album = albumData || track.album as FetchedQobuzAlbum
    const artists = album.artists === undefined ? [track.performer] : album.artists
    let metadata = `;FFMETADATA1`
    metadata += `\ntitle=${formatTitle(track)}`
    if (artists.length > 0) {
      metadata += `\nartist=${formatArtists(track)}`
      metadata += `\nalbum_artist=${formatArtists(track)}`
    } else {
      metadata += `\nartist=Various Artists`
      metadata += `\nalbum_artist=Various Artists`
    }
    metadata += `\nalbum_artist=${artists[0]?.name || track.performer?.name || 'Various Artists'}`
    metadata += `\nalbum=${formatTitle(album)}`
    metadata += `\ngenre=${album.genre?.name || 'Unknown Genre'}`
    metadata += `\ndate=${album.release_date_original || 'Unknown Date'}`
    metadata += `\nyear=${album.release_date_original ? new Date(album.release_date_original).getFullYear() : 'Unknown Year'}`
    metadata += `\nlabel=${album.label?.name || 'Unknown Label'}`
    metadata += `\ncopyright=${track.copyright}`
    if (track.isrc) metadata += `\nisrc=${track.isrc}`
    if (track.track_number) metadata += `\ntrack=${track.track_number}`

    const metadataPath = path.join(outputDir, 'metadata.txt')
    fs.writeFileSync(metadataPath, metadata)

    const metadataArgs = ['-y', '-i', currentInput, '-i', metadataPath, '-map_metadata', '1', '-codec', 'copy', temp2]
    await runFFmpeg(metadataArgs)
    currentInput = temp2
  }

  // Step 3: Embed album art if applicable
  if (settings.applyMetadata && !['WAV', 'OPUS'].includes(settings.outputCodec)) {
    try {
      const albumArtURL = getFullResImageUrl(track)
      const albumArtResponse = await axios.get(albumArtURL, { responseType: 'arraybuffer' })
      const albumArtPath = path.join(outputDir, 'albumArt.jpg')
      fs.writeFileSync(albumArtPath, Buffer.from(albumArtResponse.data))

      const artArgs = ['-y', '-i', currentInput, '-i', albumArtPath, '-c', 'copy', '-map', '0', '-map', '1', '-disposition:v:0', 'attached_pic', outputPath]
      await runFFmpeg(artArgs)
    } catch (e) {
      console.warn('Failed to download album art:', e)
      // If art fails, just copy to output
      fs.copyFileSync(currentInput, outputPath)
    }
  } else {
    // No art, just move to output
    fs.renameSync(currentInput, outputPath)
  }

  // Clean up temp files
  const cleanup = [inputPath, temp1, temp2, path.join(outputDir, 'metadata.txt'), path.join(outputDir, 'albumArt.jpg')]
  cleanup.forEach(file => {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  })

  console.log('Processed file:', outputPath)
}

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', args)
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`))
      }
    })
    ffmpeg.on('error', (err) => {
      reject(err)
    })
    ffmpeg.stderr.on('data', (data) => {
      console.log('FFmpeg stderr:', data.toString())
    })
  })
}
