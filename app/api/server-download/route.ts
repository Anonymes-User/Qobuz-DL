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

interface ProgressEvent {
  type: 'progress' | 'complete' | 'error'
  message?: string
  progress?: number
}

export async function POST(request: NextRequest) {
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

  const encoder = new TextEncoder()
  let progress = 0

  const sendProgress = (controller: ReadableStreamDefaultController, message: string, prog?: number) => {
    if (prog !== undefined) progress = prog
    const event = `data: ${JSON.stringify({type: 'progress', message, progress})}\n\n`
    controller.enqueue(encoder.encode(event))
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        sendProgress(controller, 'Starting download', 0)

        if (track) {
          sendProgress(controller, 'Processing track', 10)
          await processTrack(track, settings, formattedTitle || 'Unknown', fullPath, undefined, (msg, prog) => sendProgress(controller, msg, prog))
          sendProgress(controller, 'Track completed', 100)
        } else if (album_id) {
          sendProgress(controller, 'Fetching album data', 5)
          const albumData = await getAlbumInfo(album_id)
          const totalTracks = albumData.tracks.items.length
          sendProgress(controller, `Fetched album: ${albumData.title} (${totalTracks} tracks)`, 10)

          const folderTitle = formatCustomTitle(settings.folderName, albumData)
          const albumFolder = path.join(fullPath, cleanFolderPath(folderTitle))
          if (!fs.existsSync(albumFolder)) {
            fs.mkdirSync(albumFolder, { recursive: true })
          }

          for (let i = 0; i < albumData.tracks.items.length; i++) {
            const track = albumData.tracks.items[i]
            if (track && track.streamable) {
              const trackProgress = 10 + (i / totalTracks) * 80
              sendProgress(controller, `Processing track ${i+1}/${totalTracks}: ${track.title}`, trackProgress)
              track.album = albumData
              const trackTitle = formatCustomTitle(settings.trackName, track)
              await processTrack(track, settings, trackTitle, albumFolder, albumData, (msg, prog) => {
                // For per-track sub-progress, adjust the overall progress
                const subProgress = prog ? prog / 100 * (80 / totalTracks) : 0
                sendProgress(controller, msg, 10 + (i / totalTracks) * 80 + subProgress)
              })
            }
          }
          sendProgress(controller, 'Album completed', 100)
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'complete'})}\n\n`))
      } catch (error: any) {
        console.error('Server download error:', error)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type: 'error', message: error.message})}\n\n`))
      } finally {
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

async function processTrack(track: QobuzTrack, settings: SettingsProps, title: string, outputDir: string, albumData?: FetchedQobuzAlbum, sendProgress?: (msg: string, prog?: number) => void) {
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
    sendProgress?.('Downloading audio', 20)
    console.log('Got URL, downloading...')

    // Download audio
    const audioResponse = await axios.get(trackUrl, { responseType: 'arraybuffer' })
    const audioBuffer = Buffer.from(audioResponse.data)
    sendProgress?.('Audio downloaded', 40)
    console.log('Downloaded, size:', audioBuffer.length)

    // Save raw audio
    const rawPath = path.join(os.tmpdir(), `raw_${track.id}.flac`)
    fs.writeFileSync(rawPath, audioBuffer)
    sendProgress?.('Saved to temp', 50)
    console.log('Saved raw file to temp:', rawPath)

    // Apply FFmpeg processing if needed
    if (
      settings.applyMetadata ||
      !(
        (settings.outputQuality === '27' && settings.outputCodec === 'FLAC') ||
        (settings.bitrate === 320 && settings.outputCodec === 'MP3')
      )
    ) {
      sendProgress?.('Applying FFmpeg processing', 60)
      console.log('Applying FFmpeg...')
      await applyFFmpeg(rawPath, settings, finalOutputDir, title, track, albumData, sendProgress)
      sendProgress?.('FFmpeg processing complete', 90)
      console.log('FFmpeg applied')
    } else {
      sendProgress?.('No processing needed', 90)
      console.log('No FFmpeg needed')
    }
  } catch (error) {
    console.error('Error processing track:', error)
    throw error
  }
}

async function applyFFmpeg(inputPath: string, settings: SettingsProps, outputDir: string, title: string, track: QobuzTrack, albumData?: FetchedQobuzAlbum, sendProgress?: (msg: string, prog?: number) => void) {
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
    const reencodeArgs = ['-loglevel', 'quiet', '-y', '-i', inputPath]
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

    const metadataArgs = ['-loglevel', 'quiet', '-y', '-i', currentInput, '-i', metadataPath, '-map_metadata', '1', '-codec', 'copy', temp2]
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

      const artArgs = ['-loglevel', 'quiet', '-y', '-i', currentInput, '-i', albumArtPath, '-c', 'copy', '-map', '0', '-map', '1', '-disposition:v:0', 'attached_pic', outputPath]
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
