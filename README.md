# Antenas 3D

**Web publicada:** <https://genarotrucchi.github.io/antenas-3d/> ·
[Cámara AR](https://genarotrucchi.github.io/antenas-3d/ar.html) ·
[Marcadores para imprimir](https://genarotrucchi.github.io/antenas-3d/marcadores.html)

Visor web de patrones de radiación (campo lejano) para las antenas del laboratorio:
dipolo, Yagi-Uda y bocina piramidal. Funciona en PC (mouse) y en celulares o tablets (táctil),
sin instalar nada y sin conexión a internet (Three.js está incluido en `vendor/`).

## Cómo correrlo en local

Requiere Python 3. Doble clic en `servir.bat`, o desde una terminal en esta carpeta:

```
python -m http.server 8000 --bind 0.0.0.0
```

- En la PC: <http://localhost:8000>
- En celulares de la **misma red Wi-Fi**: `http://<IP-de-la-PC>:8000` (la IP la muestra `servir.bat`).
  Si no carga, Windows puede estar bloqueando el puerto: hay que permitir Python en el firewall
  para redes privadas.

> Abrir `index.html` con doble clic no funciona: los módulos de JavaScript necesitan un servidor.

## Qué muestra

- **Patrón 3D** coloreado por ganancia (dBi), con radio en dB (rango dinámico ajustable) o lineal.
- **Onda**: campo instantáneo Re{E} ∝ F(θ,φ)·cos(kr − ωt)/r en el plano E o H. La barra inferior
  mueve el tiempo (ωt) y el botón ▶ la anima.
- **Frentes de onda 3D**: una esfera por cresta, con brillo proporcional al patrón.
- **Métricas**: directividad, HPBW en planos E y H, frente/espalda y lóbulos secundarios.
- **Cortes polares** de los planos E y H.

## Cámara AR (`ar.html`)

Apuntando la cámara del celular a un marcador impreso, la app reconoce la antena y dibuja su
patrón anclado al marcador; se puede caminar alrededor.

1. Imprimí `marcadores.html` a tamaño real (por defecto, cuadrado negro de 15 cm) y pegá cada
   hoja en su antena: vertical, con la flecha → hacia la dirección de máxima radiación (+x).
2. Abrí la versión publicada (HTTPS) en el celular → **Cámara AR** → *Iniciar cámara*.
3. En *Ajustes* indicá la posición del centro de la antena respecto del marcador (se guarda por antena).

Detalles técnicos: marcadores ArUco (diccionario ARUCO_MIP_36h12, ids 1 = dipolo, 2 = Yagi,
3 = bocina) detectados con [js-aruco2](https://github.com/damianofalcioni/js-aruco2); pose calculada
por homografía con refinamiento subpíxel de esquinas (`js/pose.js`). *Probar sin cámara* muestra una
demo con un marcador sintético. La cámara **solo funciona con HTTPS** (o `localhost`).

## Modelos (analíticos)

| Antena | Modelo | Parámetros |
|---|---|---|
| Dipolo | Dipolo delgado de longitud L, corriente sinusoidal | L |
| Yagi-Uda | Array end-fire de N dipolos λ/2, fase tipo Hansen-Woodyard y corrientes decrecientes | N, d |
| Bocina | Apertura a×b con modo TE10 y factor de Huygens (sin error de fase) | a, b |

Ejes: z hacia arriba. El dipolo es vertical (eje z); la Yagi y la bocina apuntan hacia +x.

## Estructura

```
index.html        página
css/style.css     estilos
js/antennas.js    modelos de campo lejano y descripción de cada antena  ← agregar antenas acá
js/pattern.js     muestreo, directividad, HPBW, F/B, lóbulos
js/models.js      geometría 3D de cada antena
js/polar.js       diagramas polares 2D
js/radiation.js   escena del patrón (patrón 3D, onda, frentes, antena), compartida
js/main.js        visor 3D e interfaz
js/ar.js          modo cámara AR (detección, pose, interfaz)
js/pose.js        pose del marcador (homografía + refinamiento subpíxel)
ar.html           página de cámara AR
marcadores.html   marcadores para imprimir
vendor/           Three.js r169 y js-aruco2 (locales)
```

## Próximos pasos posibles

- Cargar patrones reales (exportaciones de CST / HFSS / mediciones de cámara anecoica).
- Publicar en GitHub Pages (HTTPS), necesario para giroscopio y realidad aumentada.
- Vista AR (WebXR en Android, Quick Look en iOS) y anclaje sobre la antena real.
