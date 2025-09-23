const urlInput = document.getElementById("url");
const form = document.getElementById("download-form");
const progressBar = document.getElementById("progress-bar");
const downloadAnchor = document.getElementById("download-anchor");
const metadataPreview = document.getElementById("metadata-preview");
const trackTitle = document.getElementById("track-title");
const trackArtist = document.getElementById("track-artist");
const trackDuration = document.getElementById("track-duration");
const trackCover = document.getElementById("song-cover");
const audioPlayer = document.getElementById("audio-player");
const browseButton = document.getElementById("browse-button");
const outputDirectoryInput = document.getElementById("output_directory");
const progressText = document.getElementById("progress-text");
const spinner = document.getElementById("spinner");

let checkProgressInterval;
let audioFileUrl = null;
let downloadId = null;
const baseUrl = "/";

const spotifyUrlRegex =
  /^(https:\/\/(open|www)\.spotify\.com\/(intl-\w+\/)?track\/[a-zA-Z0-9]{22})(\?.*)?$/;

browseButton.addEventListener("click", () => {
  spinner.classList.remove("hidden"); // Mostrar spinner
  browseButton.disabled = true;
  browseButton.textContent = "Cargando...";

  const input = document.createElement("input");
  input.type = "file";
  input.setAttribute("webkitdirectory", "");
  input.setAttribute("directory", "");
  input.onchange = (e) => {
    if (e.target.files.length > 0) {
      const selectedFolder = e.target.files[0].webkitRelativePath.split("/")[0];
      outputDirectoryInput.value = selectedFolder;
    }
    spinner.classList.add("hidden");
    browseButton.disabled = false;
    browseButton.textContent = "Seleccionar Carpeta";
  };
  input.click();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  const outputDirectory = outputDirectoryInput.value.trim();

  if (!url) {
    showError("Por favor, ingresa un enlace de descarga.");
  }

  if (!url || !spotifyUrlRegex.test(url)) {
    showError("Por favor, ingresa un enlace válido de Spotify.");
  }

  if (!outputDirectory) {
    showError("Por favor, selecciona una carpeta para guardar la música.");
    return;
  }

  try {
    const metadataResponse = await fetch(
      `/get_metadata?url=${encodeURIComponent(decodeURIComponent(url))}`
    );
    const metadata = await metadataResponse.json();

    if (metadata.error) {
      showError(metadata.error);
      return;
    }

    trackTitle.textContent = `Título: ${metadata.title}`;
    trackArtist.textContent = `Artista: ${metadata.artist}`;
    trackDuration.textContent = `Duración: ${metadata.duration}`;
    trackCover.src = metadata.cover || "ruta/de/imagen/default.jpg";
    metadataPreview.classList.add("visible", "animate__fadeIn");

    await handleDownload(url, outputDirectory, metadata.title);
  } catch (error) {
    showError(`Ocurrió un error: ${error.message}`);
  }
});

async function handleDownload(url, outputDirectory, title) {
  try {
    const response = await fetch("/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, folder: outputDirectory }),
    });

    const data = await response.json();

    if (response.ok && data.download_id) {
      downloadId = data.download_id;

      Swal.fire({
        title: "Proceso iniciado",
        text: "Descarga iniciada, por favor espera...",
        icon: "info",
        confirmButtonText: "Aceptar",
      });

      checkProgressInterval = setInterval(
        () => checkProgress(downloadId),
        1000
      );
      progressBar.style.width = "0%";
      progressText.textContent = "Esperando descarga... 0%";
    } else {
      showError(`Error: ${data.error || "No se recibió download_id."}`);
    }
  } catch (error) {
    showError(`Error al iniciar la descarga: ${error.message}`);
  }
}

async function checkProgress() {
  if (!downloadId) {
    clearInterval(checkProgressInterval);
    showError("ID de descarga no definido.");
    return;
  }

  try {
    const response = await fetch(`/progress?download_id=${downloadId}`);
    const data = await response.json();

    console.log("Progreso recibido:", data); // Log para depuración
    console.log("Valor de progressBar:", progressBar); // Log para depuración
    console.log("Valor de data.progress:", data.progress); // Log para depuración

    if (data.error) {
      clearInterval(checkProgressInterval);
      showError(`Error: ${data.error}`);
      return;
    }

    // Verifica si la descarga se ha completado

    if (data.completed) {
      progressBar.style.width = data.progress + "%";
      progressText.textContent = data.progress + "%";
      clearInterval(checkProgressInterval);
      audioFileUrl = baseUrl + data.fileUrl;
      downloadAnchor.href = audioFileUrl;
      downloadAnchor.download = generateFileName(trackTitle.textContent);
      downloadAnchor.style.display = "block";
      progressBar.style.backgroundColor = "#390c74";

      Swal.fire({
        title: "¡Descarga Completa!",
        text: "Tu archivo ha sido descargado con éxito.",
        icon: "success",
        confirmButtonText: "Aceptar",
      }).then(() => resetUI());
    } else {
      progressBar.style.width = `${data.progress}%`;
      progressText.textContent = `${data.progress}%`;
    }
  } catch (error) {
    clearInterval(checkProgressInterval);
    showError(`Error al verificar el progreso: ${error.message}`);
  }
}

audioPlayer.addEventListener("play", () => {
  if (audioFileUrl && !audioPlayer.src) {
    audioPlayer.src = audioFileUrl;
    audioPlayer.load();
  }
});

audioPlayer.addEventListener("error", (e) => {
  if (audioPlayer.src) {
    let errorMessage;
    switch (audioPlayer.error.code) {
      case 1:
        errorMessage = "Reproducción cancelada por el usuario.";
        break;
      case 2:
        errorMessage = "Error de red. Verifica tu conexión.";
        break;
      case 3:
        errorMessage = "Formato de audio no compatible.";
        break;
      case 4:
        errorMessage = "El archivo no es compatible con tu navegador.";
        break;
      default:
        errorMessage = "Error desconocido al reproducir el audio.";
    }
    showError(errorMessage);
  }
});

function resetUI() {
  if (progressBar) {
    progressBar.style.width = "";
    progressBar.textContent = "";
    progressBar.style.backgroundColor = "";
  }

  if (progressText) {
    progressText.textContent = "";
  }

  const estimatedTimeElement = document.getElementById("estimated-time");
  if (estimatedTimeElement) {
    estimatedTimeElement.textContent = "";
  }

  if (downloadAnchor) {
    downloadAnchor.style.display = "none";
  }

  urlInput.value = "";
  outputDirectoryInput.value = "";
  audioFileUrl = null;
  audioPlayer.src = "";
}

function generateFileName(title) {
  return `${title.replace("Título: ", "")}.mp3`;
}

function showError(message) {
  Swal.fire("Error", message, "error");
}
