Purdue Parking Finder - https://lrbudreau.github.io/parking/

This is a personal project designed to help me learn more about geospatial data, Leaflet.js, and working with GeoJSON and ArcGIS Feature Layers.
While the application displays real data from Purdue University, it is not affiliated with or maintained by Purdue University.

🚗 Overview

This web application provides a dynamic, interactive parking map of the Purdue University campus. Users can view the locations of parking lots and campus buildings, filter parking types, and access directions.

The goal of this project is to gain hands-on experience working with geospatial datasets, spatial queries, and mapping tools in a real-world context.

📍 Data Sources

All building and parking location data is sourced from publicly available datasets hosted by Purdue University's [ArcGIS Online portal](https://purdueuniversity.maps.arcgis.com):

Purdue Campus Buildings
[View on ArcGIS](https://purdueuniversity.maps.arcgis.com/home/item.html?id=5646e36cfdd84fd5804dd14235844ed7)

Surface Parking Lots (includes Grant Street, Harrison Street and McCutcheon Drive garages)
[FeatureServer](https://services1.arcgis.com/mLNdQKiKsj5Z5YMN/arcgis/rest/services/SurfaceParkingLots/FeatureServer/0)

Accessible Parking Spaces
[FeatureServer](https://services1.arcgis.com/mLNdQKiKsj5Z5YMN/arcgis/rest/services/HandicapVehicleSpaces/FeatureServer/0)

These datasets are accessed live through their respective FeatureService endpoints.

Garages not in Purdue's lot layer (Wood Street, Northwestern Avenue, University Street) are drawn from `data/garages.geojson`; their outlines are approximate. Temporary construction closures go in `data/construction.geojson` (entries disappear automatically after their `endDate`).

Readable names for Purdue's lot permit codes live in the `PERMIT_LABELS` table at the top of `_assets/js/parking-map.js`. Codes without an entry are shown as-is.

⚠️ Disclaimer

This application is not an official Purdue University product.
It is maintained independently by Larissa Budreau as a personal learning tool.

For any questions or suggestions, feel free to contact me at:
📧 lbudreau2015@yahoo.com

🔧 Technologies Used

Leaflet.js
 – Interactive maps

Esri Leaflet
 – ArcGIS Feature Layer integration

HTML / CSS / JavaScript

Public GeoJSON and ArcGIS REST Services 
