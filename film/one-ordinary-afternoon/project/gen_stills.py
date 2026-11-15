import sys; sys.path.insert(0,'project'); from xai import *
from concurrent.futures import ThreadPoolExecutor
REF="stills/s1.jpg"
P="Same room, same pale oak table, same matte black phone, same dark green cloth notebook, same mustard-yellow mug, same afternoon light as the reference image. The person wears a chunky oatmeal-cream knit sweater. "
shots={
"s2":"Close-up, low angle across the table top: the matte black smartphone lies face down on the oak wood in a band of sunlight; a hand with an oatmeal knit sleeve is reaching in from the right, fingertips just about to touch the phone. Mustard mug and green notebook soft in the background. Only hand and forearm in frame.",
"s3":"Medium shot from directly behind: a person stands at the tall window looking out at the green garden, holding the black phone to their right ear, seen entirely from behind, back of head and shoulders softly silhouetted against the bright window, face completely hidden. The oak table with mug and notebook is at the edge of frame in the foreground, out of focus.",
"s4":"Overhead close-up of the table: the green notebook now lies open to a cream page with three short lines of small, soft out-of-focus handwritten pencil notes at the top and the rest of the page empty; a left hand with an oatmeal knit sleeve rests flat on the page edge, the black pen lying in the gutter. Mustard mug at the corner of frame. Only hands in frame.",
"s5":"Extreme macro close-up, very shallow depth of field: a right hand with an oatmeal knit cuff holds the black pen with its tip touching an empty cream notebook page, about to write a single line; warm sunlight rakes across the paper texture. Only fingers, pen and paper in frame.",
"s6":"Close-up side angle: a hand with an oatmeal knit sleeve is laying the matte black phone face down on the oak table next to the closed dark green notebook with the pen on top; the sunlight band is lower and warmer, more golden. Only hand and forearm in frame.",
"s7":"Wide shot from behind at hip height: a person in an oatmeal knit sweater and dark trousers walks away from camera towards an open glass garden door flooded with golden afternoon light, carrying the mustard-yellow mug in one hand at their side; framed from the shoulders down, head out of frame above. The oak table with green sweater on the chair in the foreground left, out of focus.",
}
with ThreadPoolExecutor(6) as ex:
    for k,v in shots.items(): ex.submit(image,k,P+v,REF,2)
