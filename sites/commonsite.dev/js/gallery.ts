import lightGallery from "lightgallery"
import autoPlay from 'lightgallery/plugins/autoplay'
import fullScreen from 'lightgallery/plugins/fullscreen'
import lgZoom from 'lightgallery/plugins/zoom'
import 'lightgallery/css/lightgallery.css'
import 'lightgallery/css/lg-autoplay.css'
import 'lightgallery/css/lg-fullscreen.css'
import 'lightgallery/css/lg-zoom.css'

document.addEventListener("DOMContentLoaded", function () {
    lightGallery(document.getElementById('lightgallery'), {
        plugins: [lgZoom, autoPlay, fullScreen],
        speed: 500,
        thumbnail: true,
        slideShowAutoplay: true,
        slideShowInterval: 3000,
    });
})