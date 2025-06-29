/*
** EPITECH PROJECT, 2025
** deezer.ts
** File description:
** Module to handle Deezer API interactions for music management
*/
import axios from 'axios';
import { createMusic, existMusic, updateBmTofMusic } from './db';
import { analyseBpm } from './bpm';
import { v4 as uuidv4 } from 'uuid';
import { uploadFile } from './s3';
import { logger } from './logger';

const coverSize = {
    small: '56x56',
    medium: '250x250',
    large: '500x500',
    xl: '1000x1000'
};

export function getCoverUrl(albumPicture: any, size = 'medium') {
    return `https://cdn-images.dzcdn.net/images/cover/${albumPicture}/${(coverSize as any)[size]}.jpg`;
}

function isrcToTimestamp(isrcCode: any) {
    if (isrcCode.length !== 12) {
        throw new Error("Code ISRC invalide");
    }
    const yearPart = isrcCode.substring(5, 7);
    const year = parseInt("20" + yearPart, 10);
    const date = new Date(year, 0, 1);
    return date.getTime();
}

export async function add_music(api: any, song_id: any) {
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
        try {
            const [exists, track] = await Promise.all([
                existMusic(song_id),
                api.getTrackInfo(song_id)
            ]);
            
            if (exists) {
                return;
            }
            
            const trackData = await api.getTrackDownloadUrl(track, 1);
            if (!trackData) {
                logger.log({ level: 'error', message: `Failed to get track download URL for song ID ${song_id}` });
                return;
            }
            
            logger.log({ level: 'info', message: `Downloading track ${track.SNG_TITLE} (${track.SNG_ID})` });
            const {data} = await axios.get(trackData.trackUrl, {responseType: 'arraybuffer'});
            const outFile = trackData.isEncrypted ? api.decryptDownload(data, track.SNG_ID) : data;
            const trackWithMetadata = await api.addTrackTags(outFile, track, 500);
             
            const new_uid = uuidv4();
            await uploadFile(new_uid, trackWithMetadata);
            await createMusic(track.SNG_ID, track.SNG_TITLE, track.ART_NAME, track.ART_ID, track.ALB_TITLE, "", track.DURATION, isrcToTimestamp(track.ISRC).toString(), new_uid, getCoverUrl(track.ALB_PICTURE, 'medium'), track.RANK);
            
            try {
                const btm = await analyseBpm(trackWithMetadata);
                await updateBmTofMusic(track.SNG_ID, btm);
                return btm;
            } catch (err) {
                logger.log({ level: 'error', message: `BPM analysis failed for song ID ${song_id}: ${(err as any).message}` });
            }
            
            break;
        } catch (error) {
            attempts++;
            logger.log({ level: 'error', message: `Attempt ${attempts} failed for song ID ${song_id}: ${(error as any).message}` });
            if (attempts >= maxAttempts) {
                logger.log({ level: 'error', message: `Failed to add music after ${maxAttempts} attempts for song ID ${song_id}` });
            }
        }
    }
}