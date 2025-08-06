#!/usr/bin/env python3

import os
from PIL import Image, ImageDraw, ImageFont

def create_icon(size):
    """Create a simple grid icon"""
    # Create image with gradient background
    img = Image.new('RGBA', (size, size), (102, 126, 234, 255))
    draw = ImageDraw.Draw(img)
    
    # Draw grid lines
    padding = size // 5
    grid_size = size - 2 * padding
    cell_size = grid_size // 3
    
    # White grid lines
    line_width = max(1, size // 16)
    
    # Vertical lines
    for i in range(4):
        x = padding + i * cell_size
        draw.line([(x, padding), (x, padding + grid_size)], fill='white', width=line_width)
    
    # Horizontal lines  
    for i in range(4):
        y = padding + i * cell_size
        draw.line([(padding, y), (padding + grid_size, y)], fill='white', width=line_width)
    
    # Add 'C' in center
    try:
        font_size = size // 3
        font = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", font_size)
    except:
        font = ImageFont.load_default()
    
    text_bbox = draw.textbbox((0, 0), "C", font=font)
    text_width = text_bbox[2] - text_bbox[0] 
    text_height = text_bbox[3] - text_bbox[1]
    text_x = (size - text_width) // 2
    text_y = (size - text_height) // 2
    
    draw.text((text_x, text_y), "C", fill='white', font=font)
    
    return img

# Create icons
sizes = [16, 48, 128]
icons_dir = '/private/var/www/html/chrome-extension/cognito-table/icons'

for size in sizes:
    icon = create_icon(size)
    icon.save(f'{icons_dir}/icon{size}.png')
    print(f'Created icon{size}.png')

print('Icons created successfully!')