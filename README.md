# Asignaciones CIng1 ANECA

Aplicación web para asignar títulos (Grado / Máster) a evaluadores, buscando:

1. **Afinidad temática** entre el título y el área/ámbito de conocimiento del evaluador.
2. **Equilibrio de esfuerzo** entre evaluadores.

Funciona entera en el navegador: las Excel **no se suben a ningún servidor**.

## Uso

1. **Datos**: carga la Excel de evaluadores y la de títulos (`.xlsx`, `.xls`, `.ods` o `.csv`).
   La aplicación intenta reconocer las columnas; revisa el emparejamiento en los desplegables.
   Hay plantillas de ejemplo descargables.
   - Evaluadores: nombre (obligatorio), área (obligatorio; varias áreas separadas por `;`),
     universidad, capacidad (peso relativo, 1 por defecto; 0 = no disponible), email.
   - Títulos: denominación (obligatorio), código/RUCT, nivel, tipo de evaluación, universidad, rama.
     Si falta el nivel se deduce de la denominación ("Grado en…", "Máster…").
2. **Esfuerzos**: esfuerzo de cada evaluación (Verificación, Modificación, Seguimiento, Alegación)
   para Grado y Máster, y parámetros: evaluadores por título, prioridad afinidad/equilibrio,
   evitar conflictos de universidad.
3. **Afinidad**: palabras clave de cada área. La afinidad se mide buscando esas palabras en la
   denominación del título. Se puede ver qué títulos no tienen ningún evaluador afín.
4. **Asignación**: calcula, revisa la carga de cada evaluador, cambia a mano lo que haga falta
   (los cambios manuales quedan fijados 🔒 y se respetan al recalcular) y exporta a Excel.

El trabajo se guarda automáticamente en el navegador. Para compartirlo con otra persona:
**Datos → Exportar sesión** y la otra persona usa **Importar sesión**.

## Algoritmo

Se minimiza `peso_afinidad · Σ(1 − afinidad) + Σ_evaluadores ((carga − objetivo) / esfuerzo_medio)²`,
donde el objetivo de cada evaluador es el esfuerzo total repartido según su capacidad.
Primero una asignación voraz (títulos más restringidos y más costosos primero) y después
búsqueda local con movimientos e intercambios hasta que no hay mejora.

## Publicación (GitHub Pages)

Settings → Pages → *Deploy from a branch* → rama `main`, carpeta `/ (root)`.
La web quedará en `https://<usuario>.github.io/AsignacionesCIng1ANECA/`.
(En repositorios privados, GitHub Pages requiere un plan de pago.)

También se puede usar sin publicar: descargar el repositorio y abrir `index.html`.

## Licencias

Lectura/escritura de Excel con [SheetJS](https://sheetjs.com) (Apache 2.0), incluido en `vendor/`.
