#include <stdlib.h>
#include <string.h>

#include "d_net.h"
#include "doomstat.h"
#include "i_net.h"
#include "i_system.h"
#include "m_argv.h"

extern doomcom_t* doomcom;

void I_InitNetwork(void)
{
    int parameter;

    doomcom = malloc(sizeof(*doomcom));
    if (!doomcom)
    {
        I_Error("Could not allocate doomcom");
    }

    memset(doomcom, 0, sizeof(*doomcom));

    parameter = M_CheckParm("-dup");
    if (parameter && parameter < myargc - 1)
    {
        doomcom->ticdup = myargv[parameter + 1][0] - '0';
        if (doomcom->ticdup < 1)
        {
            doomcom->ticdup = 1;
        }
        if (doomcom->ticdup > 9)
        {
            doomcom->ticdup = 9;
        }
    }
    else
    {
        doomcom->ticdup = 1;
    }

    doomcom->extratics = M_CheckParm("-extratic") ? 1 : 0;
    doomcom->id = DOOMCOM_ID;
    doomcom->numplayers = 1;
    doomcom->numnodes = 1;
    doomcom->consoleplayer = 0;

    deathmatch = false;
    netgame = false;
}

void I_NetCmd(void)
{
    if (doomcom)
    {
        doomcom->remotenode = -1;
    }
}
