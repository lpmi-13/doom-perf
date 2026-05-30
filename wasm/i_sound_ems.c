#include <stdio.h>
#include <string.h>

#include <emscripten.h>

#include "doomdef.h"
#include "i_sound.h"
#include "w_wad.h"
#include "z_zone.h"

#ifdef SNDSERV
FILE* sndserver = 0;
char* sndserver_filename = "web-audio";
#endif

EM_JS(void, js_I_InitSound, (), {
    if (Module._doomAudio) {
        Module._doomAudio.initSound();
    }
});

EM_JS(void, js_I_ShutdownSound, (), {
    if (Module._doomAudio) {
        Module._doomAudio.shutdownSound();
    }
});

EM_JS(int, js_I_StartSound,
      (int sfx_id, const char* name, const byte* data, int data_len,
       int vol, int sep, int pitch, int priority), {
    if (!Module._doomAudio) {
        return -1;
    }

    var buffer = null;
    if (data && data_len > 8) {
        buffer = HEAPU8.slice(data, data + data_len);
    }

    return Module._doomAudio.startSound(
        sfx_id,
        UTF8ToString(name),
        buffer,
        data_len,
        vol,
        sep,
        pitch,
        priority
    );
});

EM_JS(void, js_I_StopSound, (int handle), {
    if (Module._doomAudio) {
        Module._doomAudio.stopSound(handle);
    }
});

EM_JS(int, js_I_SoundIsPlaying, (int handle), {
    if (!Module._doomAudio) {
        return 0;
    }

    return Module._doomAudio.soundIsPlaying(handle) ? 1 : 0;
});

EM_JS(void, js_I_UpdateSoundParams,
      (int handle, int vol, int sep, int pitch), {
    if (Module._doomAudio) {
        Module._doomAudio.updateSoundParams(handle, vol, sep, pitch);
    }
});

EM_JS(void, js_I_ShutdownMusic, (), {
    if (Module._doomAudio) {
        Module._doomAudio.shutdownMusic();
    }
});

EM_JS(void, js_I_SetMusicVolume, (int volume), {
    if (Module._doomAudio) {
        Module._doomAudio.setMusicVolume(volume);
    }
});

EM_JS(void, js_I_PauseSong, (int handle), {
    if (Module._doomAudio) {
        Module._doomAudio.pauseSong(handle);
    }
});

EM_JS(void, js_I_ResumeSong, (int handle), {
    if (Module._doomAudio) {
        Module._doomAudio.resumeSong(handle);
    }
});

EM_JS(int, js_I_RegisterSong, (const byte* data, int len), {
    if (!Module._doomAudio || !data || len <= 0) {
        return 0;
    }

    return Module._doomAudio.registerSong(HEAPU8.slice(data, data + len));
});

EM_JS(void, js_I_PlaySong, (int handle, int looping), {
    if (Module._doomAudio) {
        Module._doomAudio.playSong(handle, looping);
    }
});

EM_JS(void, js_I_StopSong, (int handle), {
    if (Module._doomAudio) {
        Module._doomAudio.stopSong(handle);
    }
});

EM_JS(void, js_I_UnRegisterSong, (int handle), {
    if (Module._doomAudio) {
        Module._doomAudio.unregisterSong(handle);
    }
});

EM_JS(void, js_I_SetSfxVolume, (int volume), {
    if (Module._doomAudio) {
        Module._doomAudio.setSfxVolume(volume);
    }
});

static int FindSfxLump(const sfxinfo_t* sfx)
{
    char lump_name[20];
    int lump_num;

    snprintf(lump_name, sizeof(lump_name), "ds%s", sfx->name);
    lump_num = W_CheckNumForName(lump_name);
    if (lump_num < 0)
    {
        lump_num = W_GetNumForName("dspistol");
    }

    return lump_num;
}

static int MusDataLength(const byte* data)
{
    int score_len;
    int score_start;

    if (!data || memcmp(data, "MUS\x1a", 4) != 0)
    {
        return 0;
    }

    score_len = data[4] | (data[5] << 8);
    score_start = data[6] | (data[7] << 8);
    return score_start + score_len;
}

void I_InitSound(void)
{
    js_I_InitSound();
}

void I_ShutdownSound(void)
{
    js_I_ShutdownSound();
}

void I_SetChannels(void)
{
}

void I_UpdateSound(void)
{
}

void I_SubmitSound(void)
{
}

int I_GetSfxLumpNum(sfxinfo_t* sfx)
{
    const sfxinfo_t* source = sfx->link ? sfx->link : sfx;
    return FindSfxLump(source);
}

int I_StartSound(int id, int vol, int sep, int pitch, int priority)
{
    sfxinfo_t* sfx;
    int lump_num;
    int lump_len;
    byte* lump_data;

    if (id <= 0 || id >= NUMSFX)
    {
        return -1;
    }

    sfx = &S_sfx[id];
    if (sfx->link)
    {
        sfx = sfx->link;
    }

    lump_num = sfx->lumpnum >= 0 ? sfx->lumpnum : FindSfxLump(sfx);
    sfx->lumpnum = lump_num;
    lump_len = W_LumpLength(lump_num);
    lump_data = W_CacheLumpNum(lump_num, PU_CACHE);

    return js_I_StartSound(
        id,
        sfx->name,
        lump_data,
        lump_len,
        vol,
        sep,
        pitch,
        priority
    );
}

void I_StopSound(int handle)
{
    js_I_StopSound(handle);
}

int I_SoundIsPlaying(int handle)
{
    return js_I_SoundIsPlaying(handle);
}

void I_UpdateSoundParams(int handle, int vol, int sep, int pitch)
{
    js_I_UpdateSoundParams(handle, vol, sep, pitch);
}

void I_SetSfxVolume(int volume)
{
    js_I_SetSfxVolume(volume);
}

void I_InitMusic(void)
{
}

void I_ShutdownMusic(void)
{
    js_I_ShutdownMusic();
}

void I_SetMusicVolume(int volume)
{
    js_I_SetMusicVolume(volume);
}

void I_PauseSong(int handle)
{
    js_I_PauseSong(handle);
}

void I_ResumeSong(int handle)
{
    js_I_ResumeSong(handle);
}

int I_RegisterSong(void* data)
{
    return js_I_RegisterSong(data, MusDataLength(data));
}

void I_PlaySong(int handle, int looping)
{
    js_I_PlaySong(handle, looping);
}

void I_StopSong(int handle)
{
    js_I_StopSong(handle);
}

void I_UnRegisterSong(int handle)
{
    js_I_UnRegisterSong(handle);
}
