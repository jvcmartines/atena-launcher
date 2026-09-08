/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 *
 * Recorta a textura de skin do Minecraft (64x64, ou 64x32 nas antigas) para
 * gerar a cabecinha do rodapé e o boneco de frente das configurações.
 */
const nodeFetch = require('node-fetch')

export class skin2D {
    /** Cabeça 8x8, com a segunda camada (chapéu) por cima. */
    async creatHeadTexture(data) {
        let image = await getData(data)
        return await new Promise((resolve) => {
            draw(image, () => {
                let cvs = document.createElement('canvas');
                cvs.width = 8;
                cvs.height = 8;
                let ctx = cvs.getContext('2d');
                ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
                ctx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
                return resolve(cvs.toDataURL());
            }, resolve);
        })
    }

    /**
     * Boneco de frente, 16x32. `slim` usa braços de 3px (modelo Alex).
     *
     * Skins antigas são 64x32 e não têm braço/perna esquerdos próprios — nesse
     * caso espelhamos os direitos, que é o que o jogo faz.
     */
    async creatBodyTexture(data, slim = false) {
        let image = await getData(data)

        return await new Promise((resolve) => {
            draw(image, () => {
                let armWidth = slim ? 3 : 4;
                let legacy = image.height < 64;

                let cvs = document.createElement('canvas');
                cvs.width = 16;
                cvs.height = 32;
                let ctx = cvs.getContext('2d');
                ctx.imageSmoothingEnabled = false;

                // base, depois a segunda camada por cima
                const parte = (sx, sy, sw, sh, dx, dy, overlay) => {
                    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, sw, sh);
                    if (overlay) ctx.drawImage(image, overlay[0], overlay[1], sw, sh, dx, dy, sw, sh);
                };

                // cabeça e tronco
                parte(8, 8, 8, 8, 4, 0, [40, 8]);
                parte(20, 20, 8, 12, 4, 8, legacy ? null : [20, 36]);

                // braço direito (aparece à esquerda de quem olha)
                parte(44, 20, armWidth, 12, 4 - armWidth, 8, legacy ? null : [44, 36]);
                // perna direita
                parte(4, 20, 4, 12, 4, 20, legacy ? null : [4, 36]);

                if (legacy) {
                    // espelha o lado direito para formar o esquerdo
                    ctx.save();
                    ctx.scale(-1, 1);
                    ctx.drawImage(image, 44, 20, armWidth, 12, -(12 + armWidth), 8, armWidth, 12);
                    ctx.drawImage(image, 4, 20, 4, 12, -12, 20, 4, 12);
                    ctx.restore();
                } else {
                    parte(36, 52, armWidth, 12, 12, 8, [52, 52]);
                    parte(20, 52, 4, 12, 8, 20, [4, 52]);
                }

                return resolve(cvs.toDataURL());
            }, resolve);
        })
    }
}

/** Executa quando a imagem carregar — ou já agora, se veio do cache. */
function draw(image, onReady, onError) {
    if (image.complete && image.naturalWidth) return onReady();
    image.addEventListener('load', onReady);
    image.addEventListener('error', () => onError(null));
}

async function getData(data) {
    if (data.startsWith('http')) {
        let response = await nodeFetch(data);
        let buffer = await response.buffer();
        data = `data:image/png;base64,${await buffer.toString('base64')}`;
    }
    let img = new Image();
    img.src = data;
    return img;
}
