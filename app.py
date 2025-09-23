import os
import time
import logging
import uuid
from flask import Flask, render_template, request, jsonify, send_file, abort
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import re
from threading import Thread, Lock
import yt_dlp

# Configuración de logs
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__, static_folder='static')
DOWNLOAD_FOLDER = 'downloads'
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

# Configurar Spotify
client_credentials_manager = SpotifyClientCredentials(
    client_id=os.getenv("SPOTIFY_CLIENT_ID"),
    client_secret=os.getenv("SPOTIFY_CLIENT_SECRET")
)
spotify = spotipy.Spotify(client_credentials_manager=client_credentials_manager)

downloads = {}
downloads_lock = Lock()

def sanitize_filename(filename):
    """Limpia el nombre del archivo"""
    return re.sub(r'[<>:"/\\|?*]', '', filename).strip()

def get_expected_filename(track_name, artist_name):
    return sanitize_filename(f"{track_name} - {artist_name}.mp3")

def download_song(url, output_directory, download_id):
    try:
        # Obtener metadatos de Spotify
        track_id = url.split("/")[-1].split("?")[0]
        track = spotify.track(track_id)
        artist_names = ", ".join(artist["name"] for artist in track["artists"])
        track_name = track['name']
        
        expected_filename = get_expected_filename(track_name, artist_names)
        output_file = os.path.join(output_directory, expected_filename)

        # Verificar si ya existe
        if os.path.exists(output_file):
            with downloads_lock:
                downloads[download_id].update({
                    'completed': True,
                    'fileUrl': f'/download/{expected_filename}',
                    'debug': "El archivo ya existe.",
                    'progress': 100
                })
            return

        with downloads_lock:
            downloads[download_id] = {
                'progress': 10,
                'completed': False,
                'fileUrl': None,
                'error': None,
                'debug': "Buscando en YouTube..."
            }

        # Buscar en YouTube usando yt-dlp
        search_query = f"{track_name} {artist_names} official audio"
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(output_directory, '%(title)s.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': True,
            'no_warnings': True,
            'default_search': f'ytsearch1:"{search_query}"',
            'noplaylist': True,
            'cachedir': False,
            'no_cache_dir': True,
        }

        def progress_hook(d):
            if d['status'] == 'downloading':
                progress = 20
                if 'downloaded_bytes' in d and 'total_bytes' in d:
                    progress = 20 + int(70 * (d['downloaded_bytes'] / d['total_bytes']))
                with downloads_lock:
                    if download_id in downloads:
                        downloads[download_id]['progress'] = progress
                        downloads[download_id]['debug'] = f"Descargando: {d.get('_percent_str', '')}"

        ydl_opts['progress_hooks'] = [progress_hook]

        with downloads_lock:
            downloads[download_id]['progress'] = 20
            downloads[download_id]['debug'] = "Iniciando descarga..."

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([search_query])

        # Buscar el archivo descargado y renombrar
        for file in os.listdir(output_directory):
            if file.endswith('.mp3'):
                actual_file = os.path.join(output_directory, file)
                os.rename(actual_file, output_file)
                break

        with downloads_lock:
            downloads[download_id].update({
                'completed': True,
                'fileUrl': f'/download/{expected_filename}',
                'debug': "Descarga completada!",
                'progress': 100
            })

    except Exception as e:
        with downloads_lock:
            downloads[download_id].update({
                'error': str(e),
                'debug': f"Error: {str(e)}",
                'progress': 100
            })
        logging.error(f"Error: {str(e)}")

# Las rutas de Flask se mantienen igual
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/download', methods=['POST'])
def download():
    data = request.get_json()
    url = data.get('url')

    if not url or "open.spotify.com" not in url:
        return jsonify({'error': 'URL de Spotify no válida'}), 400

    download_id = uuid.uuid4().hex
    with downloads_lock:
        downloads[download_id] = {
            'progress': 0,
            'completed': False,
            'fileUrl': None,
            'error': None,
            'debug': "Preparando descarga..."
        }
    
    thread = Thread(target=download_song, args=(url, DOWNLOAD_FOLDER, download_id))
    thread.daemon = True
    thread.start()

    return jsonify({'success': True, 'download_id': download_id}), 200

@app.route('/progress', methods=['GET'])
def progress():
    download_id = request.args.get('download_id')
    if not download_id:
        return jsonify({'error': 'ID de descarga no proporcionado'}), 400
    
    with downloads_lock:
        data = downloads.get(download_id)
    
    if not data:
        return jsonify({'error': 'ID de descarga no encontrado'}), 404

    return jsonify(data)

@app.route('/download/<filename>')
def serve_file(filename):
    file_path = os.path.join(DOWNLOAD_FOLDER, filename)
    if not os.path.exists(file_path):
        return abort(404, description="Archivo no encontrado")
    return send_file(file_path, as_attachment=True, mimetype='audio/mpeg')

@app.route('/get_metadata', methods=['GET'])
def get_metadata():
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "URL no proporcionada"}), 400

    try:
        track_id = url.split("/")[-1].split("?")[0]
        track = spotify.track(track_id)
        metadata = {
            "title": track["name"],
            "artist": ", ".join(artist["name"] for artist in track["artists"]),
            "duration": f"{track['duration_ms'] // 60000}:{(track['duration_ms'] // 1000) % 60:02}",
            "cover": track["album"]["images"][0]["url"],
            "preview_url": track["preview_url"]
        }
        return jsonify(metadata), 200
    except Exception as e:
        logging.error(f"Error obteniendo metadatos: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
